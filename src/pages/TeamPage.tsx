import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { UserMinus, UserPlus, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { Header } from '../components/layout/Header';
import { Breadcrumb } from '../components/common/Breadcrumb';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
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
        <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-neutral-800 break-all">
              {m.email ?? m.userId}
              {me && <Badge variant="info" className="ml-2">You</Badge>}
              {m.archived && <Badge variant="default" className="ml-2">Removed</Badge>}
            </p>
            <p className="text-xs text-neutral-500">
              {m.updatedAt ? `Changed ${format(new Date(m.updatedAt), 'MMM d, yyyy')}${m.updatedBy ? ` by ${m.updatedBy}` : ''}` : `Since ${format(new Date(m.createdAt), 'MMM d, yyyy')}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!m.archived && (
              <label className="flex items-center gap-2 text-sm">
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
                  className="border border-neutral-300 rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-siue-red"
                >
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]} ({ROLE_HELP[r]})</option>
                  ))}
                </select>
              </label>
            )}
            {m.archived ? (
              <Button size="sm" variant="secondary" disabled={busy !== null}
                onClick={() => void change(m, () => setMemberArchived(m.userId, false), `${m.email ?? 'Account'} added back`)}>
                <UserPlus size={14} /> Add back
              </Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy !== null}
                onClick={() => confirm({
                  title: `Remove ${m.email ?? 'this account'} from the team?`,
                  message: 'They keep their account but count as a viewer: they can read, not change anything. You can add them back from the list below.',
                  confirmLabel: 'Remove from team',
                }, () => change(m, () => setMemberArchived(m.userId, true), `${m.email ?? 'Account'} removed from the team`))}>
                <UserMinus size={14} /> Remove from team
              </Button>
            )}
          </div>
        </li>
      );
    };
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
          {active.length ? <ul className="divide-y divide-neutral-100">{active.map(row)}</ul> : (
            <EmptyState icon={<Users size={32} />} title="No accounts" description="Accounts appear here when they sign up." />
          )}
        </Card>
        {removed.length > 0 && (
          <Card padding={false}>
            <div className="px-6 pt-5 pb-2">
              <h2 className="text-base font-semibold text-neutral-800">Removed from the team <span className="text-neutral-400 font-normal">({removed.length})</span></h2>
              <p className="text-xs text-neutral-500">They count as viewers.</p>
            </div>
            <ul className="divide-y divide-neutral-100">{removed.map(row)}</ul>
          </Card>
        )}
        <Card padding={false}>
          <div className="px-6 pt-5 pb-2">
            <h2 className="text-base font-semibold text-neutral-800">Change log</h2>
            <p className="text-xs text-neutral-500">Every role change, kept by the database. Nobody can edit it.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wider text-neutral-500 bg-neutral-50 border-y border-neutral-100">
                  <th className="px-6 py-2.5">When</th>
                  <th className="px-4 py-2.5">Who</th>
                  <th className="px-4 py-2.5">Account</th>
                  <th className="px-4 py-2.5">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {log.map((c) => (
                  <tr key={c.id}>
                    <td className="px-6 py-3 whitespace-nowrap text-neutral-600">{format(new Date(c.changedAt), 'MMM d, yyyy h:mm a')}</td>
                    <td className="px-4 py-3 text-neutral-600 break-all">{c.changedByEmail ?? '—'}</td>
                    <td className="px-4 py-3 break-all">{c.email ?? c.userId}</td>
                    <td className="px-4 py-3">{describeChange(c)}</td>
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
      <div className="p-8 space-y-6 max-w-4xl">{body()}</div>
      {dialog}
    </div>
  );
}
