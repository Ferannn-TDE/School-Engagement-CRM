import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Users, ShieldCheck, ShieldOff } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { FilterBar } from '../components/common/FilterBar';
import { Badge } from '../components/common/Badge';
import { DataTable } from '../components/common/DataTable';
import { Modal } from '../components/common/Modal';
import { EmptyState } from '../components/common/EmptyState';
import { ContactForm } from '../components/contacts/ContactForm';
import { useAppContext } from '../context/useAppContext';
import { useUrlState } from '../hooks/useUrlState';
import type { Contact } from '../types';
import { ContactRole, ContactRoleLabels } from '../types';
import { contactRoleLabel } from '../utils/contactRoles';
import { FreshnessIcon, FreshnessLegend } from '../components/common/FreshnessIcon';
import { OneLine } from '../components/common/OneLine';
import { contactFreshness } from '../utils/freshness';
import { useRole } from '../context/useRole';
import { RowMenu } from '../components/common/RowActions';
import { Missing } from '../components/common/Missing';
import { useContactActions } from '../components/contacts/useContactActions';

type VerifiedTab = 'all' | 'verified' | 'unverified';

export function ContactsPage() {
  const { state, getSchoolById } = useAppContext();
  const { canEdit } = useRole();
  // Kept in the address so the view survives leaving the tab, a refresh and Back.
  const [search, setSearch] = useUrlState('q');
  const [roleFilter, setRoleFilter] = useUrlState('role');
  const [schoolFilter, setSchoolFilter] = useUrlState('school');
  const [activeFilter, setActiveFilter] = useUrlState('status');
  const [tabRaw, setVerifiedTab] = useUrlState('tab', 'all');
  const verifiedTab = (['all', 'verified', 'unverified'].includes(tabRaw) ? tabRaw : 'all') as VerifiedTab;
  const [showAddModal, setShowAddModal] = useState(false);
  const { menuItems, dialogs } = useContactActions();

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
        meta: { kind: 'primary' },
        // Two lines at most: the name (with the amber icon when something needs
        // attention) and the job title, each cut to fit.
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <OneLine className="font-medium text-neutral-800">{`${row.original.firstName} ${row.original.lastName}`.trim()}</OneLine>
              <FreshnessIcon flags={contactFreshness(row.original)} name={`${row.original.firstName} ${row.original.lastName}`.trim()} />
            </div>
            {row.original.title && <OneLine className="text-xs text-neutral-500">{row.original.title}</OneLine>}
          </div>
        ),
      },
      {
        accessorKey: 'email',
        header: 'Email',
        meta: { kind: 'text', width: '15rem' },
        cell: ({ row }) => row.original.email
          ? <OneLine className="text-neutral-700">{row.original.email}</OneLine>
          : <Missing label="No email" />,
      },
      {
        accessorKey: 'phone',
        header: 'Phone',
        meta: { kind: 'text', width: '10rem' },
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
        meta: { kind: 'badge', width: '10rem' },
        cell: ({ row }) => <Badge variant="info">{contactRoleLabel(row.original)}</Badge>,
      },
      {
        id: 'school',
        header: 'School',
        meta: { kind: 'text', width: '14rem' },
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
        meta: { kind: 'badge' },
        cell: ({ getValue }) => (
          <Badge variant={getValue() ? 'success' : 'default'}>
            {getValue() ? 'Active' : 'Inactive'}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        meta: { kind: 'actions' },
        enableSorting: false,
        cell: ({ row }) => {
          const c = row.original;
          const name = `${c.firstName} ${c.lastName}`.trim() || 'this contact';
          return (
            <RowMenu name={name} items={menuItems(c)} />
          );
        },
      },
    ],
    [getSchoolById, menuItems]
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
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">

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
                'flex items-center gap-1.5 px-3 py-1.5 pointer-coarse:min-h-10 rounded-md text-xs font-medium transition-colors ' +
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
          <>
          <Card padding={false}>
            <DataTable
              data={filteredContacts}
              exportCsv={{
                name: 'contacts',
                columns: [
                  { label: 'First name', value: (c) => c.firstName },
                  { label: 'Last name', value: (c) => c.lastName },
                  { label: 'Title', value: (c) => c.title },
                  { label: 'Role', value: (c) => contactRoleLabel(c) },
                  { label: 'Email', value: (c) => c.email },
                  { label: 'Phone', value: (c) => c.phone },
                  { label: 'School', value: (c) => getSchoolById(c.schoolId)?.name },
                  { label: 'County', value: (c) => getSchoolById(c.schoolId)?.county },
                  { label: 'Status', value: (c) => (c.isActive ? 'Active' : 'Inactive') },
                  { label: 'Verified', value: (c) => (c.isVerified ? 'Yes' : 'No') },
                  { label: 'Last updated', value: (c) => c.lastUpdatedAt?.slice(0, 10) },
                ],
              }}
              columns={shownColumns}
              searchValue={search}
              urlState
              resetKey={[verifiedTab, roleFilter, schoolFilter, activeFilter].join('|')}
              emptyMessage="No contacts match your filters."
            />
          </Card>
          <FreshnessLegend />
          </>
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

      {dialogs}
    </div>
  );
}
