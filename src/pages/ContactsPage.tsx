import { useState, useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Users, Search, Mail, Phone } from 'lucide-react';
import { format } from 'date-fns';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Select } from '../components/common/Select';
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

export function ContactsPage() {
  const { state, getSchoolById, updateContact, deleteContact } = useAppContext();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deletingContact, setDeletingContact] = useState<Contact | null>(null);

  const filteredContacts = useMemo(() => {
    let contacts = state.contacts;
    if (roleFilter) contacts = contacts.filter((c) => c.role === roleFilter);
    if (schoolFilter) contacts = contacts.filter((c) => c.schoolId === schoolFilter);
    if (activeFilter === 'active') contacts = contacts.filter((c) => c.isActive);
    if (activeFilter === 'inactive') contacts = contacts.filter((c) => !c.isActive);
    return contacts;
  }, [state.contacts, roleFilter, schoolFilter, activeFilter]);

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
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
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
    [getSchoolById, updateContact]
  );

  const roleOptions = Object.values(ContactRole).map((role) => ({
    value: role,
    label: ContactRoleLabels[role],
  }));

  const schoolOptions = state.schools.map((s) => ({
    value: s.id,
    label: s.name,
  }));

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
        {/* Filters */}
        <Card>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="search"
                  placeholder="Search contacts..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-siue-red/30 focus:border-siue-red"
                />
              </div>
            </div>
            <Select
              options={roleOptions}
              placeholder="All Roles"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="w-48"
            />
            <Select
              options={schoolOptions}
              placeholder="All Schools"
              value={schoolFilter}
              onChange={(e) => setSchoolFilter(e.target.value)}
              className="w-48"
            />
            <Select
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
              placeholder="All Status"
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value)}
              className="w-36"
            />
            {(roleFilter || schoolFilter || activeFilter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRoleFilter('');
                  setSchoolFilter('');
                  setActiveFilter('');
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </Card>

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
