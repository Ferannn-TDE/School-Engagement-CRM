import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Users, ShieldCheck, ShieldOff, CheckCircle, Pencil, UserX, UserCheck, Archive } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { FilterBar } from '../components/common/FilterBar';
import { Badge } from '../components/common/Badge';
import { DataTable } from '../components/common/DataTable';
import { Modal } from '../components/common/Modal';
import { EmptyState } from '../components/common/EmptyState';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { ContactForm } from '../components/contacts/ContactForm';
import { useAppContext } from '../context/useAppContext';
import { useUrlState } from '../hooks/useUrlState';
import type { Contact } from '../types';
import { ContactRole, ContactRoleLabels } from '../types';
import { contactRoleLabel } from '../utils/contactRoles';
import toast from 'react-hot-toast';
import { FreshnessIcon } from '../components/common/FreshnessIcon';
import { OneLine } from '../components/common/OneLine';
import { contactFreshness } from '../utils/freshness';
import { useRole } from '../context/useRole';
import { RowMenu } from '../components/common/RowActions';
import { Missing } from '../components/common/Missing';
import { useConfirm } from '../hooks/useConfirm';

type VerifiedTab = 'all' | 'verified' | 'unverified';

export function ContactsPage() {
  const { state, getSchoolById, updateContact, archiveContact, verifyContact, unverifyContact } = useAppContext();
  const { canEdit } = useRole();
  // Kept in the address so the view survives leaving the tab, a refresh and Back.
  const [search, setSearch] = useUrlState('q');
  const [roleFilter, setRoleFilter] = useUrlState('role');
  const [schoolFilter, setSchoolFilter] = useUrlState('school');
  const [activeFilter, setActiveFilter] = useUrlState('status');
  const [tabRaw, setVerifiedTab] = useUrlState('tab', 'all');
  const verifiedTab = (['all', 'verified', 'unverified'].includes(tabRaw) ? tabRaw : 'all') as VerifiedTab;
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [archivingContact, setArchivingContact] = useState<Contact | null>(null);
  const { confirm, dialog } = useConfirm();

  const unverifiedCount = useMemo(
    () => state.contacts.filter((c) => !c.isVerified).length,
    [state.contacts]
  );

  const filteredContacts = useMemo(() => {
    let contacts = state.contacts;
    if (verifiedTab === 'verified') contacts = contacts.filter((c) => c.isVerified);
    else if (verifiedTab === 'unverified') contacts = contacts.filter((c) => !c.isVerified);
    if (roleFilter) contacts = contacts.filter((c) => c.role === roleFilter);
    if (schoolFilter) contacts = contacts.filter((c) => c.schoolId === schoolFilter);
    if (activeFilter === 'active') contacts = contacts.filter((c) => c.isActive);
    if (activeFilter === 'inactive') contacts = contacts.filter((c) => !c.isActive);
    return contacts;
  }, [state.contacts, verifiedTab, roleFilter, schoolFilter, activeFilter]);

  const columns: ColumnDef<Contact, unknown>[] = useMemo(
    () => [
      {
        accessorFn: (row) => `${row.firstName} ${row.lastName}`,
        id: 'name',
        header: 'Name',
        // Two lines at most: the name (with the amber icon when something needs
        // attention) and the job title, each cut to fit.
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <OneLine className="font-medium text-neutral-800">{`${row.original.firstName} ${row.original.lastName}`.trim()}</OneLine>
              <FreshnessIcon flags={contactFreshness(row.original)} />
            </div>
            {row.original.title && <OneLine className="text-xs text-neutral-500">{row.original.title}</OneLine>}
          </div>
        ),
      },
      {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => row.original.email
          ? <OneLine className="text-neutral-700">{row.original.email}</OneLine>
          : <Missing label="No email" />,
      },
      {
        accessorKey: 'phone',
        header: 'Phone',
        // One line: the number, then any extension in smaller text, cut to fit.
        cell: ({ row }) => {
          const phone = row.original.phone;
          if (!phone) return <Missing label="No phone" />;
          const [number, ext] = phone.split(/\s*(?:ext\.?|x)\s*(?=\d)/i);
          return (
            <OneLine className="text-neutral-700" title={phone}>
              {number}
              {ext && <span className="ml-1 text-xs text-neutral-500">ext. {ext}</span>}
            </OneLine>
          );
        },
      },
      {
        accessorKey: 'role',
        header: 'Role',
        cell: ({ row }) => <Badge variant="info">{contactRoleLabel(row.original)}</Badge>,
      },
      {
        id: 'school',
        header: 'School',
        accessorFn: (row) => getSchoolById(row.schoolId)?.name || '',
        cell: ({ row }) => {
          const school = getSchoolById(row.original.schoolId);
          return school ? (
            <Link
              to={`/schools/${encodeURIComponent(school.id)}`}
              className="block truncate text-neutral-700 hover:text-siue-red transition-colors"
              title={school.name}
              onClick={(e) => e.stopPropagation()}
            >
              {school.name}
            </Link>
          ) : (
            <Missing label="No school" />
          );
        },
      },
      {
        accessorKey: 'isActive',
        header: 'Status',
        cell: ({ getValue }) => (
          <Badge variant={getValue() ? 'success' : 'default'}>
            {getValue() ? 'Active' : 'Inactive'}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="block text-right">Actions</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const c = row.original;
          const name = `${c.firstName} ${c.lastName}`.trim() || 'this contact';
          return (
            <RowMenu
              name={name}
              items={[
                { icon: <Pencil size={14} />, label: 'Edit', onClick: () => setEditingContact(c) },
                // Verified is an on/off switch; turning it off asks first.
                c.isVerified
                  ? {
                    icon: <ShieldOff size={14} />,
                    label: 'Unverify',
                    onClick: () => confirm({
                      title: `Unverify ${name}?`,
                      message: `${name} goes back to the Unverified list. Nothing else changes. Your name and the time are recorded.`,
                      confirmLabel: 'Unverify',
                    }, () => unverifyContact(c.id)),
                  }
                  : { icon: <CheckCircle size={14} />, label: 'Verify', onClick: () => verifyContact(c.id) },
                c.isActive
                  ? {
                    icon: <UserX size={14} />,
                    label: 'Deactivate',
                    tone: 'danger',
                    onClick: () => confirm({
                      title: `Deactivate ${name}?`,
                      message: `${name} stays on file but is left out of email lists and active counts. You can activate them again at any time.`,
                      confirmLabel: 'Deactivate',
                    }, () => {
                      updateContact({ ...c, isActive: false });
                      toast.success('Contact deactivated');
                    }),
                  }
                  : {
                    icon: <UserCheck size={14} />,
                    label: 'Activate',
                    onClick: () => {
                      updateContact({ ...c, isActive: true });
                      toast.success('Contact activated');
                    },
                  },
                { icon: <Archive size={14} />, label: 'Archive', tone: 'danger', onClick: () => setArchivingContact(c) },
              ]}
            />
          );
        },
      },
    ],
    [getSchoolById, updateContact, verifyContact, unverifyContact, confirm]
  );

  const roleOptions = Object.values(ContactRole).map((role) => ({
    value: role,
    label: ContactRoleLabels[role],
  }));

  const schoolOptions = [...state.schools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ value: s.id, label: s.name }));


  // Viewers (db/023) get no edit, verify or archive buttons; the database refuses those writes anyway.
  const shownColumns = useMemo(
    () => (canEdit ? columns : columns.filter((c) => c.id !== 'actions')),
    [columns, canEdit]
  );
  return (
    <div>
<Header
        title="Contacts"
        subtitle={`${state.contacts.length.toLocaleString()} contacts in database`}
        actions={
          canEdit &&
          <Button size="sm" onClick={() => setShowAddModal(true)}>
            <Plus size={16} />
            Add Contact
          </Button>
        }
      />
      <div className="p-8 space-y-6">

        {/* Verified / Unverified tabs */}
        <div className="flex gap-1 bg-neutral-100 p-1 rounded-lg w-fit">
          {([
            { key: 'all', label: 'All', icon: <Users size={14} /> },
            { key: 'verified', label: 'Verified', icon: <ShieldCheck size={14} /> },
            { key: 'unverified', label: 'Unverified', icon: <ShieldOff size={14} /> },
          ] as const).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setVerifiedTab(key)}
              className={
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ' +
                (verifiedTab === key
                  ? 'bg-white text-neutral-800 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700')
              }
            >
              {icon}
              {label}
              {key === 'unverified' && unverifiedCount > 0 && (
                <span className="ml-0.5 bg-warning/20 text-warning rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none">
                  {unverifiedCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Filters */}
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search contacts..."
          filters={[
            { value: roleFilter, onChange: setRoleFilter, options: roleOptions, placeholder: 'All Roles', className: 'w-48' },
            { value: schoolFilter, onChange: setSchoolFilter, options: schoolOptions, placeholder: 'All Schools', className: 'w-48' },
            {
              value: activeFilter,
              onChange: setActiveFilter,
              options: [
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ],
              placeholder: 'All Status',
              className: 'w-36',
            },
          ]}
          onClear={() => {
            setRoleFilter('');
            setSchoolFilter('');
            setActiveFilter('');
          }}
        />

        {state.contacts.length === 0 ? (
          <EmptyState
            icon={<Users size={32} />}
            title="No contacts yet"
            description="Add your first contact or import from a spreadsheet."
            action={canEdit &&
              <Button onClick={() => setShowAddModal(true)}>
                <Plus size={16} />
                Add Contact
              </Button>
            }
          />
        ) : verifiedTab === 'verified' && filteredContacts.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={32} />}
            title="No verified contacts yet"
            description="Switch to the Unverified tab to review and verify contacts."
          />
        ) : verifiedTab === 'unverified' && filteredContacts.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={32} />}
            title="All contacts are verified"
            description="Every contact record has been verified."
          />
        ) : (
          <Card padding={false}>
            <DataTable
              data={filteredContacts}
              columns={shownColumns}
              columnWidths={canEdit ? ['', '', '12rem', '10rem', '', '7rem', '8rem'] : ['', '', '12rem', '10rem', '', '7rem']}
              searchValue={search}
              urlState
              resetKey={[verifiedTab, roleFilter, schoolFilter, activeFilter].join('|')}
              emptyMessage="No contacts match your filters."
            />
          </Card>
        )}
      </div>

      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add New Contact"
        size="lg"
      >
        <ContactForm onClose={() => setShowAddModal(false)} />
      </Modal>

      <Modal
        open={!!editingContact}
        onClose={() => setEditingContact(null)}
        title="Edit Contact"
        size="lg"
      >
        {editingContact && (
          <ContactForm contact={editingContact} onClose={() => setEditingContact(null)} />
        )}
      </Modal>

      <ConfirmDialog
        open={!!archivingContact}
        onClose={() => setArchivingContact(null)}
        onConfirm={() => {
          if (archivingContact) {
            archiveContact(archivingContact.id);
            toast.success('Contact archived');
          }
        }}
        title="Archive Contact"
        message={
          archivingContact
            ? `Archive "${archivingContact.firstName} ${archivingContact.lastName}"? They'll be hidden everywhere. You can restore them from Settings → Archived.`
            : ''
        }
        confirmLabel="Archive Contact"
      />
      {dialog}
    </div>
  );
}
