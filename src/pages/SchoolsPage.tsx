import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, School, Search, MapPin } from 'lucide-react';
import { format } from 'date-fns';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Select } from '../components/common/Select';
import { Badge } from '../components/common/Badge';
import { DataTable } from '../components/common/DataTable';
import { Modal } from '../components/common/Modal';
import { EmptyState } from '../components/common/EmptyState';
import { SchoolForm } from '../components/schools/SchoolForm';
import { useAppContext } from '../context/AppContext';
import type { School as SchoolType } from '../types';
import { formatSchoolType } from '../utils/helpers';

export function SchoolsPage() {
  const { state, getContactsBySchool, getActivitiesBySchool } = useAppContext();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [countyFilter, setCountyFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const filteredSchools = useMemo(() => {
    let schools = state.schools;
    if (countyFilter) schools = schools.filter((s) => s.county === countyFilter);
    if (typeFilter) schools = schools.filter((s) => s.schoolType === typeFilter);
    return schools;
  }, [state.schools, countyFilter, typeFilter]);

  const uniqueCounties = useMemo(
    () => [...new Set(state.schools.map((s) => s.county))].sort(),
    [state.schools]
  );

  const columns: ColumnDef<SchoolType, unknown>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'School Name',
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-neutral-800">{row.original.name}</p>
            {row.original.district && (
              <p className="text-xs text-neutral-400">{row.original.district}</p>
            )}
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
        {/* Filters */}
        <Card>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="search"
                  placeholder="Search schools..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-siue-red/30 focus:border-siue-red"
                />
              </div>
            </div>
            <Select
              options={uniqueCounties.map((c) => ({ value: c, label: c }))}
              placeholder="All Counties"
              value={countyFilter}
              onChange={(e) => setCountyFilter(e.target.value)}
              className="w-48"
            />
            <Select
              options={[
                { value: 'high_school', label: 'High School' },
                { value: 'middle_school', label: 'Middle School' },
              ]}
              placeholder="All Types"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-48"
            />
            {(countyFilter || typeFilter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCountyFilter('');
                  setTypeFilter('');
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </Card>

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
        ) : (
          <Card padding={false}>
            <DataTable
              data={filteredSchools}
              columns={columns}
              searchValue={search}
              onRowClick={(school) => navigate(`/schools/${school.id}`)}
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
