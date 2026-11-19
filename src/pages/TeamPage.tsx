import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { UserMinus, UserPlus, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { Header } from '../components/layout/Header';
import { Breadcrumb } from '../components/common/Breadcrumb';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { EmptyState } from '../components/common/EmptyState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useAuth } from '../context/useAuth';
import { useRole } from '../context/useRole';
import {
  fetchRoleChanges,
  fetchTeam,
  setMemberArchived,
  setMemberRole,
  type Role,
  type RoleChange,
  type TeamMember,
} from '../services/rolesService';
import { databaseMessage } from '../utils/writeErrors';
import { useConfirm } from '../hooks/useConfirm';
import { RowAction, RowActions } from '../components/common/RowActions';
import { IconButton } from '../components/common/IconButton';
import { Missing } from '../components/common/Missing';
import { ColGroup, cellClass, headClass, tableProps, type ColumnSpec } from '../components/common/tableColumns';

/** Account, Role, Last change, Actions. */
const ACCOUNT_COLUMNS: ColumnSpec[] = ['primary', { kind: 'text', width: '19rem' }, { kind: 'text', width: '16rem' }, 'actions'];
/** When, Who, Account, Change. */
const LOG_COLUMNS: ColumnSpec[] = [{ kind: 'date', width: '12rem' }, { kind: 'text', width: '15rem' }, { kind: 'text', width: '15rem' }, 'primary'];

const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };
const ROLE_RANK: Record<Role, number> = { admin: 3, editor: 2, viewer: 1 };
const ROLE_HELP: Record<Role, string> = {
  admin: 'everything, including this page',
  editor: 'view and change data',
  viewer: 'view only',
};

function describeChange(c: RoleChange): string {
  if (c.oldRole === undefined) return `added as ${ROLE_LABELS[c.newRole]}`;
  const parts: string[] = [];
  if (c.oldRole !== c.newRole) parts.push(`${ROLE_LABELS[c.oldRole]} → ${ROLE_LABELS[c.newRole]}`);
  if (c.oldArchived !== c.newArchived) parts.push(c.newArchived ? 'removed from the team' : 'added back to the team');
  return parts.join(', ');
}

/**
 * Settings → Team (db/023), for admins: every account with its role, and the log of
 * every change. The database enforces the rules (only admins change roles, nobody
 * raises their own, there is always an admin); its messages are shown as they are.
 */
export function TeamPage() {
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading, rolesEnabled, refresh } = useRole();
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [log, setLog] = useState<RoleChange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      const [members, changes] = await Promise.all([fetchTeam(), fetchRoleChanges()]);
      setTeam(members);
      setLog(changes);
      setError(null);
    } catch (err) {
      setError(databaseMessage(err));
      setTeam([]);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const change = async (m: TeamMember, run: () => Promise<void>, done: string) => {
    setBusy(m.userId);
    try {
      await run();
      toast.success(done);
      await load();
      if (m.userId === user?.id) await refresh();
    } catch (err) {
      // e.g. "There must always be at least one admin: make someone else admin first"
      toast.error(databaseMessage(err), { duration: 8000 });
    } finally {
      setBusy(null);
    }
  };

  const body = () => {
    if (roleLoading) return <LoadingSpinner />;
    if (!rolesEnabled) {
      return <Card><p className="text-sm text-neutral-700">Roles aren’t set up in the database yet (migration 023). Until then every account can edit.</p></Card>;
    }
    if (!isAdmin) {
      return <Card><p className="text-sm text-neutral-700">Only admins can see and change the team. Ask an admin if your access needs to change.</p></Card>;
    }
    if (team === null) return <LoadingSpinner />;
    if (error) return <Card><p className="text-sm text-neutral-700">The team couldn’t be loaded: {error}</p></Card>;
    const active = team.filter((m) => !m.archived);
    const removed = team.filter((m) => m.archived);
    const row = (m: TeamMember) => {
      const me = m.userId === user?.id;
      return (
        <tr key={m.userId} style={{ height: '4rem' }}>
          <td className={`${cellClass(ACCOUNT_COLUMNS[0])} pl-6 truncate`} title={m.email ?? m.userId}>
            <span className="font-medium text-neutral-800">{m.email ?? m.userId}</span>
            {me && <Badge variant="info" className="ml-2">You</Badge>}
          </td>
          <td className={cellClass(ACCOUNT_COLUMNS[1])}>
            {m.archived ? (
              <span className="text-neutral-500">Viewer (removed)</span>
            ) : (
              <label className="block">
                <span className="sr-only">Role for {m.email}</span>
                <select
                  value={m.role}
                  disabled={busy !== null}
                  onChange={(e) => {
                    const role = e.target.value as Role;
                    const who = m.email ?? 'this account';
                    confirm({
                      title: `Make ${who} ${role === 'admin' ? 'an admin' : `a${role === 'editor' ? 'n' : ''} ${role}`}?`,
                      message: `${who} goes from ${ROLE_LABELS[m.role]} (${ROLE_HELP[m.role]}) to ${ROLE_LABELS[role]} (${ROLE_HELP[role]}). The change is logged below.`,
                      confirmLabel: `Make ${ROLE_LABELS[role].toLowerCase()}`,
                      variant: role === 'admin' || ROLE_RANK[role] > ROLE_RANK[m.role] ? 'primary' : 'destructive',
                    }, () => change(m, () => setMemberRole(m.userId, role), `${m.email ?? 'Account'} is now ${ROLE_LABELS[role].toLowerCase()}`));
                  }}
                  className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-siue-red/30 focus:border-siue-red"
                >
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]} ({ROLE_HELP[r]})</option>
                  ))}
                </select>
              </label>
            )}
          </td>
          <td className={`${cellClass(ACCOUNT_COLUMNS[2])} text-neutral-600`}>
            {m.updatedAt ? `${format(new Date(m.updatedAt), 'MMM d, yyyy')}${m.updatedBy ? ` by ${m.updatedBy}` : ''}` : `Joined ${format(new Date(m.createdAt), 'MMM d, yyyy')}`}
          </td>
          <td className={cellClass(ACCOUNT_COLUMNS[3])}>
            <RowActions>
              {m.archived ? (
                <RowAction icon={<UserPlus size={13} />} label="Add back" disabled={busy !== null}
                  onClick={() => void change(m, () => setMemberArchived(m.userId, false), `${m.email ?? 'Account'} added back`)} />
              ) : (
                <IconButton icon={<UserMinus size={15} />} label="Remove from team" tone="danger" disabled={busy !== null}
                  onClick={() => confirm({
                    title: `Remove ${m.email ?? 'this account'} from the team?`,
                    message: 'They keep their account but count as a viewer: they can read, not change anything. You can add them back from the list below.',
                    confirmLabel: 'Remove from team',
                  }, () => change(m, () => setMemberArchived(m.userId, true), `${m.email ?? 'Account'} removed from the team`))} />
              )}
            </RowActions>
          </td>
        </tr>
      );
    };
    const accountsTable = (members: TeamMember[]) => (
      <div className="overflow-x-auto pb-2">
        <table {...tableProps(ACCOUNT_COLUMNS, 'text-sm')}>
          <ColGroup specs={ACCOUNT_COLUMNS} />
          <thead className="bg-neutral-50 border-y border-neutral-100">
            <tr>
              <th className={`${headClass(ACCOUNT_COLUMNS[0])} pl-6`}>Account</th>
              <th className={headClass(ACCOUNT_COLUMNS[1])}>Role</th>
              <th className={headClass(ACCOUNT_COLUMNS[2])}>Last change</th>
              <th className={headClass(ACCOUNT_COLUMNS[3])}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">{members.map(row)}</tbody>
        </table>
      </div>
    );
    return (
      <>
        <p className="text-sm text-neutral-600 max-w-2xl">
          New accounts start as viewers. Removing someone from the team makes them a viewer; to stop an account
          signing in at all, delete or ban it in Supabase → Authentication. To hand over admin, make the new person
          admin first, let them confirm this page works for them, then step down.
        </p>
        <Card padding={false}>
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-base font-semibold text-neutral-800">Accounts <span className="text-neutral-400 font-normal">({active.length})</span></h2>
          </div>
          {active.length ? accountsTable(active) : (
            <EmptyState icon={<Users size={32} />} title="No accounts" description="Accounts appear here when they sign up." />
          )}
        </Card>
        {removed.length > 0 && (
          <Card padding={false}>
            <div className="px-6 pt-5 pb-2">
              <h2 className="text-base font-semibold text-neutral-800">Removed from the team <span className="text-neutral-400 font-normal">({removed.length})</span></h2>
              <p className="text-xs text-neutral-500">They count as viewers.</p>
            </div>
            {accountsTable(removed)}
          </Card>
        )}
        <Card padding={false}>
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-base font-semibold text-neutral-800">Change log</h2>
            <p className="text-xs text-neutral-500">Every role change, kept by the database. Nobody can edit it.</p>
          </div>
          <div className="overflow-x-auto">
            <table {...tableProps(LOG_COLUMNS, 'text-sm')}>
              <ColGroup specs={LOG_COLUMNS} />
              <thead>
                <tr className="bg-neutral-50 border-y border-neutral-100">
                  <th className={`${headClass(LOG_COLUMNS[0])} pl-6`}>When</th>
                  <th className={headClass(LOG_COLUMNS[1])}>Who</th>
                  <th className={headClass(LOG_COLUMNS[2])}>Account</th>
                  <th className={headClass(LOG_COLUMNS[3])}>Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {log.map((c) => (
                  <tr key={c.id} style={{ height: '4rem' }}>
                    <td className={`${cellClass(LOG_COLUMNS[0])} pl-6 text-neutral-600`}>{format(new Date(c.changedAt), 'MMM d, yyyy h:mm a')}</td>
                    <td className={`${cellClass(LOG_COLUMNS[1])} truncate text-neutral-600`} title={c.changedByEmail}>{c.changedByEmail ?? <Missing label="Not recorded" />}</td>
                    <td className={`${cellClass(LOG_COLUMNS[2])} truncate`} title={c.email ?? c.userId}>{c.email ?? c.userId}</td>
                    <td className={cellClass(LOG_COLUMNS[3])}>{describeChange(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </>
    );
  };

  return (
    <div>
      <Breadcrumb crumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Team' }]} />
      <Header title="Team" subtitle="Who can do what: admins manage the team, editors change data, viewers read." />
      <div className="p-8 space-y-6">{body()}</div>
      {dialog}
    </div>
  );
}
