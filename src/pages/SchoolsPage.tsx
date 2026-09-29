import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, School, MapPin, ShieldCheck, ShieldOff, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { FilterBar } from '../components/common/FilterBar';
import type { FilterConfig } from '../components/common/FilterBar';
import { Badge } from '../components/common/Badge';
import { DataTable } from '../components/common/DataTable';
import { Modal } from '../components/common/Modal';
import { EmptyState } from '../components/common/EmptyState';
import { SchoolForm } from '../components/schools/SchoolForm';
import { useAppContext } from '../context/AppContext';
import { useUrlState } from '../hooks/useUrlState';
import { countyOptions, inCounty } from '../utils/counties';
import type { School as SchoolType } from '../types';
import { formatSchoolType } from '../utils/helpers';
import { FreshnessBadges } from '../components/common/FreshnessBadges';
import { schoolFreshness } from '../utils/freshness';

type VerifiedTab = 'all' | 'verified' | 'unverified';

export function SchoolsPage() {
  const { state, getContactsBySchool, getActivitiesBySchool, verifySchool, verifySchoolsBulk } = useAppContext();
  const navigate = useNavigate();
  // Kept in the address so the view survives leaving the tab, a refresh and Back.
  const [search, setSearch] = useUrlState('q');
  const [countyFilter, setCountyFilter] = useUrlState('county');
  const [typeFilter, setTypeFilter] = useUrlState('type');
  const [contactsRaw, setContactsFilter] = useUrlState('contacts');
  const contactsFilter = (contactsRaw === 'has' || contactsRaw === 'none' ? contactsRaw : '') as '' | 'has' | 'none';
  const [tabRaw, setVerifiedTab] = useUrlState('tab', 'all');
  const verifiedTab = (['all', 'verified', 'unverified'].includes(tabRaw) ? tabRaw : 'all') as VerifiedTab;
  const [showAddModal, setShowAddModal] = useState(false);

  const unverifiedCount = useMemo(
    () => state.schools.filter((s) => !s.isVerified).length,
    [state.schools]
  );

  const filteredSchools = useMemo(() => {
    let schools = state.schools;
    if (verifiedTab === 'verified') schools = schools.filter((s) => s.isVerified);
    else if (verifiedTab === 'unverified') schools = schools.filter((s) => !s.isVerified);
    if (countyFilter) schools = schools.filter((s) => inCounty(s, countyFilter));
    if (typeFilter) schools = schools.filter((s) => s.schoolType === typeFilter);
    if (contactsFilter === 'has') {
      schools = schools.filter((s) => getContactsBySchool(s.id).length > 0);
    } else if (contactsFilter === 'none') {
      schools = schools.filter((s) => getContactsBySchool(s.id).length === 0);
    }
    return schools;
  }, [state.schools, verifiedTab, countyFilter, typeFilter, contactsFilter, getContactsBySchool]);

  // Each county tied to its state: 40 names exist in both Illinois and Missouri.
  const uniqueCounties = useMemo(() => countyOptions(state.schools), [state.schools]);

  const schoolFilters = useMemo((): FilterConfig[] => [
    {
      value: countyFilter,
      onChange: setCountyFilter,
      options: uniqueCounties,
      placeholder: 'All Counties',
      className: 'w-48',
    },
    {
      value: typeFilter,
      onChange: setTypeFilter,
      options: [
        { value: 'high_school', label: 'High School' },
        { value: 'middle_school', label: 'Middle School' },
      ],
      placeholder: 'All Types',
      className: 'w-48',
    },
    {
      value: contactsFilter,
      onChange: (v) => setContactsFilter(v as '' | 'has' | 'none'),
      options: [
        { value: 'has', label: 'Has Contacts' },
        { value: 'none', label: 'No Contacts' },
      ],
      placeholder: 'Any Contacts',
      className: 'w-44',
    },
  ], [uniqueCounties, countyFilter, typeFilter, contactsFilter, setCountyFilter, setTypeFilter, setContactsFilter]);

  const baseColumns: ColumnDef<SchoolType, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'School Name',
        cell: ({ row }) => (
          <div>
            <Link
              to={`/schools/${encodeURIComponent(row.original.id)}`}
              className="font-medium text-neutral-800 hover:text-siue-red transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {row.original.name}
            </Link>
            {row.original.district && (
              <p className="text-xs text-neutral-500">{row.original.district}</p>
            )}
            <FreshnessBadges flags={schoolFreshness(row.original)} className="mt-1 flex flex-wrap gap-1" />
          </div>
        ),
      },
      {
        accessorKey: 'county',
        header: 'County',
        cell: ({ getValue }) => (
          <div className="flex items-center gap-1 text-neutral-600">
            <MapPin size={14} />
            {getValue() as string}
          </div>
        ),
      },
      {
        accessorKey: 'schoolType',
        header: 'Type',
        cell: ({ getValue }) => (
          <Badge>{formatSchoolType(getValue() as string)}</Badge>
        ),
      },
      {
        id: 'contacts',
        header: '# Contacts',
        cell: ({ row }) => getContactsBySchool(row.original.id).length,
      },
      {
        id: 'activities',
        header: 'Activities',
        cell: ({ row }) => getActivitiesBySchool(row.original.id).length,
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
        accessorKey: 'updatedAt',
        header: 'Last Updated',
        cell: ({ getValue }) => (
          <span className="text-neutral-500">
            {format(new Date(getValue() as string), 'MMM d, yyyy')}
          </span>
        ),
      },
    ],
    [getContactsBySchool, getActivitiesBySchool]
  );

  const verifyColumn: ColumnDef<SchoolType, unknown> = useMemo(
    () => ({
      id: 'verify',
      header: '',
      cell: ({ row }) => (
        <button
          className="flex items-center gap-1.5 text-xs font-medium text-success hover:text-success/80 transition-colors px-2 py-1 rounded-lg hover:bg-success/10"
          onClick={(e) => { e.stopPropagation(); verifySchool(row.original.id); }}
          title="Mark as verified"
        >
          <CheckCircle size={14} />
          Verify
        </button>
      ),
    }),
    [verifySchool]
  );

  const columns = useMemo(
    () => verifiedTab === 'unverified' ? [...baseColumns, verifyColumn] : baseColumns,
    [verifiedTab, baseColumns, verifyColumn]
  );

  return (
    <div>
<Header
        title="Schools"
        subtitle={`${state.schools.length} schools in directory`}
        actions={
          <Button size="sm" onClick={() => setShowAddModal(true)}>
            <Plus size={16} />
            Add School
          </Button>
        }
      />
      <div className="p-8 space-y-6">

        {/* Verified / Unverified tabs */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex gap-1 bg-neutral-100 p-1 rounded-lg">
            {([
              { key: 'all', label: 'All', icon: <School size={14} /> },
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
          {verifiedTab === 'unverified' && filteredSchools.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => verifySchoolsBulk(filteredSchools.map((s) => s.id))}
            >
              <CheckCircle size={14} />
              Mark All Verified ({filteredSchools.length})
            </Button>
          )}
        </div>

        {/* Filters */}
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search schools..."
          filters={schoolFilters}
          onClear={() => {
            setCountyFilter('');
            setTypeFilter('');
            setContactsFilter('');
          }}
        />

        {/* Table */}
        {state.schools.length === 0 ? (
          <EmptyState
            icon={<School size={32} />}
            title="No schools yet"
            description="Add your first school to start tracking engagement."
            action={
              <Button onClick={() => setShowAddModal(true)}>
                <Plus size={16} />
                Add School
              </Button>
            }
          />
        ) : verifiedTab === 'verified' && filteredSchools.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={32} />}
            title="No verified schools yet"
            description="Switch to the Unverified tab to review and verify school records."
          />
        ) : verifiedTab === 'unverified' && filteredSchools.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={32} />}
            title="All schools are verified"
            description="Great work — every school record has been verified."
          />
        ) : (
          <Card padding={false}>
            <DataTable
              data={filteredSchools}
              columns={columns}
              searchValue={search}
              urlState
              resetKey={[verifiedTab, countyFilter, typeFilter, contactsFilter].join('|')}
              onRowClick={(school) => navigate(`/schools/${encodeURIComponent(school.id)}`)}
              emptyMessage="No schools match your filters."
            />
          </Card>
        )}
      </div>

      {/* Add School Modal */}
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add New School"
        size="lg"
      >
        <SchoolForm onClose={() => setShowAddModal(false)} />
      </Modal>
    </div>
  );
}
