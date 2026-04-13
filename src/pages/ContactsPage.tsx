import { useState, useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Users, Mail, Phone, ShieldCheck, ShieldOff, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
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
import { useAppContext } from '../context/AppContext';
import type { Contact } from '../types';
import { ContactRole, ContactRoleLabels } from '../types';
import toast from 'react-hot-toast';

type VerifiedTab = 'all' | 'verified' | 'unverified';

export function ContactsPage() {
  const { state, getSchoolById, updateContact, deleteContact, verifyContact } = useAppContext();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [verifiedTab, setVerifiedTab] = useState<VerifiedTab>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deletingContact, setDeletingContact] = useState<Contact | null>(null);

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
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-neutral-800">
              {row.original.firstName} {row.original.lastName}
            </p>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-neutral-400 flex items-center gap-1">
                <Mail size={12} />
                {row.original.email}
              </span>
              {row.original.phone && (
                <span className="text-xs text-neutral-400 flex items-center gap-1">
                  <Phone size={12} />
                  {row.original.phone}
                </span>
              )}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'role',
        header: 'Role',
        cell: ({ getValue }) => (
          <Badge variant="info">{ContactRoleLabels[getValue() as ContactRole]}</Badge>
        ),
      },
      {
        id: 'school',
        header: 'School',
        accessorFn: (row) => getSchoolById(row.schoolId)?.name || 'Unknown',
        cell: ({ getValue }) => (
          <span className="text-neutral-600">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: 'isActive',
        header: 'Status',
        cell: ({ getValue }) => (
          <Badge variant={getValue() ? 'success' : 'error'}>
            {getValue() ? 'Active' : 'Inactive'}
          </Badge>
        ),
      },
      {
        accessorKey: 'lastContactDate',
        header: 'Last Contact',
        cell: ({ getValue }) => {
          const date = getValue() as string | undefined;
          return date ? (
            <span className="text-neutral-500">{format(new Date(date), 'MMM d, yyyy')}</span>
          ) : (
            <span className="text-neutral-300">-</span>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
            {!row.original.isVerified && (
              <>
                <button
                  onClick={() => verifyContact(row.original.id)}
                  className="flex items-center gap-1 text-xs text-success hover:underline"
                  title="Mark as verified"
                >
                  <CheckCircle size={12} />
                  Verify
                </button>
                <span className="text-neutral-200">|</span>
              </>
            )}
            <button
              onClick={() => setEditingContact(row.original)}
              className="text-xs text-info hover:underline"
            >
              Edit
            </button>
            <span className="text-neutral-200">|</span>
            <button
              onClick={() => {
                updateContact({ ...row.original, isActive: !row.original.isActive });
                toast.success(row.original.isActive ? 'Contact deactivated' : 'Contact activated');
              }}
              className="text-xs text-warning hover:underline"
            >
              {row.original.isActive ? 'Deactivate' : 'Activate'}
            </button>
            <span className="text-neutral-200">|</span>
            <button
              onClick={() => setDeletingContact(row.original)}
              className="text-xs text-error hover:underline"
            >
              Delete
            </button>
          </div>
        ),
      },
    ],
    [getSchoolById, updateContact, verifyContact]
  );

  const roleOptions = Object.values(ContactRole).map((role) => ({
    value: role,
    label: ContactRoleLabels[role],
  }));

  const schoolOptions = [...state.schools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ value: s.id, label: s.name }));

  return (
    <div>
      <Header
        title="Contacts"
        subtitle={`${state.contacts.length} contacts in database`}
        actions={
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
            action={
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
              columns={columns}
              searchValue={search}
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
        open={!!deletingContact}
        onClose={() => setDeletingContact(null)}
        onConfirm={() => {
          if (deletingContact) {
            deleteContact(deletingContact.id);
            toast.success('Contact deleted');
          }
        }}
        title="Delete Contact"
        message={
          deletingContact
            ? `Delete "${deletingContact.firstName} ${deletingContact.lastName}"? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete Contact"
      />
    </div>
  );
}
