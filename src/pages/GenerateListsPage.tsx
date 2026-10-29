import { useMemo } from 'react';
import { Copy, Download, MapPin } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Select } from '../components/common/Select';
import { Badge } from '../components/common/Badge';
import { useAppContext } from '../context/useAppContext';
import { useUrlState } from '../hooks/useUrlState';
import { countyChoiceLabel, countyOptions, inCounty } from '../utils/counties';
import { ContactRole, ContactRoleLabels } from '../types';
import { contactRoleLabel } from '../utils/contactRoles';
import { contactsToCsv, downloadFile } from '../utils/helpers';
import toast from 'react-hot-toast';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../components/common/DataTable';
import type { Contact, School } from '../types';

function previewColumnsFor(getSchoolById: (id: string) => School | undefined): ColumnDef<Contact, unknown>[] {
  return [
    {
      id: 'name',
      header: 'Name',
      accessorFn: (c) => `${c.firstName} ${c.lastName}`.trim(),
      cell: ({ getValue }) => <span className="block truncate font-medium text-neutral-800">{getValue() as string}</span>,
    },
    {
      accessorKey: 'email',
      header: 'Email',
      cell: ({ row }) => row.original.email
        ? <span className="block truncate text-neutral-700" title={row.original.email}>{row.original.email}</span>
        : <span className="text-neutral-400">No email</span>,
    },
    {
      id: 'role',
      header: 'Role',
      accessorFn: (c) => contactRoleLabel(c),
      cell: ({ getValue }) => <Badge variant="info">{getValue() as string}</Badge>,
    },
    {
      id: 'school',
      header: 'School',
      accessorFn: (c) => getSchoolById(c.schoolId)?.name ?? '',
      cell: ({ getValue }) => (getValue() as string)
        ? <span className="block truncate text-neutral-700" title={getValue() as string}>{getValue() as string}</span>
        : <span className="text-neutral-400">—</span>,
    },
    {
      id: 'county',
      header: 'County',
      accessorFn: (c) => getSchoolById(c.schoolId)?.county ?? '',
      cell: ({ getValue }) => <span className="block truncate text-neutral-600">{(getValue() as string) || '—'}</span>,
    },
  ];
}

export function GenerateListsPage() {
  const { state, getSchoolById } = useAppContext();
  const previewColumns = useMemo(() => previewColumnsFor(getSchoolById), [getSchoolById]);
  // Kept in the address so a list's settings survive leaving the tab, a refresh and
  // Back, and a link to a list can be shared.
  const [countyFilter, setCountyFilter] = useUrlState('county');
  const [roleFilter, setRoleFilter] = useUrlState('role');
  const [schoolTypeFilter, setSchoolTypeFilter] = useUrlState('type');
  const [eventFilter, setEventFilter] = useUrlState('event');
  const [activeRaw, setActiveRaw] = useUrlState('active', '1');
  const activeOnly = activeRaw !== '0';
  const setActiveOnly = (on: boolean) => setActiveRaw(on ? '1' : '0');
  // On by default: every scraped contact starts unverified, so leaving them out
  // produced an empty list. The export's Verified column still tells them apart.
  const [unverifiedRaw, setUnverifiedRaw] = useUrlState('unverified', '1');
  const includeUnverified = unverifiedRaw !== '0';
  const setIncludeUnverified = (on: boolean) => setUnverifiedRaw(on ? '1' : '0');
  const [formatRaw, setFormatRaw] = useUrlState('format', 'email');
  const exportFormat = (['email', 'csv', 'mailing'].includes(formatRaw) ? formatRaw : 'email') as 'email' | 'csv' | 'mailing';
  const setExportFormat = (f: 'email' | 'csv' | 'mailing') => setFormatRaw(f);

  // Each county tied to its state: 40 names exist in both Illinois and Missouri.
  const uniqueCounties = useMemo(() => countyOptions(state.schools), [state.schools]);

  const filteredContacts = useMemo(() => {
    let contacts = state.contacts;

    if (activeOnly) contacts = contacts.filter((c) => c.isActive);
    if (!includeUnverified) contacts = contacts.filter((c) => c.isVerified === true);
    if (roleFilter) contacts = contacts.filter((c) => c.role === roleFilter);

    // Filter by school attributes
    if (countyFilter || schoolTypeFilter) {
      const validSchoolIds = new Set(
        state.schools
          .filter((s) => {
            if (countyFilter && !inCounty(s, countyFilter)) return false;
            if (schoolTypeFilter && s.schoolType !== schoolTypeFilter) return false;
            return true;
          })
          .map((s) => s.id)
      );
      contacts = contacts.filter((c) => validSchoolIds.has(c.schoolId));
    }

    // Filter by event participation
    if (eventFilter) {
      const event = state.events.find((e) => e.id === eventFilter);
      if (event) {
        const schoolIds = new Set(event.participatingSchools);
        contacts = contacts.filter((c) => schoolIds.has(c.schoolId));
      }
    }

    return contacts;
  }, [state, countyFilter, roleFilter, schoolTypeFilter, eventFilter, activeOnly, includeUnverified]);

  const handleCopyEmails = () => {
    const emails = filteredContacts.map((c) => c.email).join(', ');
    navigator.clipboard.writeText(emails).then(() => {
      toast.success(`Copied ${filteredContacts.length} emails to clipboard`);
    });
  };

  const handleExportCsv = () => {
    const rows = filteredContacts.map((c) => {
      const school = getSchoolById(c.schoolId);
      return {
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone || '',
        role: contactRoleLabel(c),
        school: school?.name || '',
        county: school?.county || '',
        address: school?.address || '',
        city: school?.city || '',
        state: school?.state || '',
        zipCode: school?.zipCode || '',
        verified: c.isVerified ? 'Yes' : 'No',
      };
    });
    const csv = contactsToCsv(
      rows,
      ['firstName', 'lastName', 'email', 'phone', 'role', 'school', 'county', 'address', 'city', 'state', 'zipCode', 'verified']
    );
    downloadFile(csv, 'contacts-export.csv');
    toast.success(`Exported ${rows.length} contacts`);
  };

  const handleExportMailing = () => {
    const labels = filteredContacts.map((c) => {
      const school = getSchoolById(c.schoolId);
      return [
        `${c.firstName} ${c.lastName}`,
        school?.name || '',
        school?.address || '',
        `${school?.city || ''}, ${school?.state || ''} ${school?.zipCode || ''}`,
      ].join('\n');
    });
    downloadFile(labels.join('\n\n---\n\n'), 'mailing-labels.txt');
    toast.success(`Generated ${labels.length} mailing labels`);
  };

  const handleExport = () => {
    if (exportFormat === 'email') handleCopyEmails();
    else if (exportFormat === 'csv') handleExportCsv();
    else handleExportMailing();
  };

  const roleOptions = Object.values(ContactRole).map((role) => ({
    value: role,
    label: ContactRoleLabels[role],
  }));

  return (
    <div>
<Header
        title="Generate Lists"
        subtitle="Build filtered mailing and email lists"
      />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Filter Builder */}
          <Card className="lg:col-span-1">
            <h3 className="text-base font-semibold text-neutral-800 mb-4">Filter Contacts</h3>
            <div className="space-y-4">
              <Select
                label="County"
                options={uniqueCounties}
                placeholder="All Counties"
                value={countyFilter}
                onChange={(e) => setCountyFilter(e.target.value)}
              />
              <Select
                label="Contact Role"
                options={roleOptions}
                placeholder="All Roles"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              />
              <Select
                label="School Type"
                options={[
                  { value: 'high_school', label: 'High School' },
                  { value: 'middle_school', label: 'Middle School' },
                ]}
                placeholder="All Types"
                value={schoolTypeFilter}
                onChange={(e) => setSchoolTypeFilter(e.target.value)}
              />
              <Select
                label="Event Participation"
                options={state.events.map((e) => ({
                  value: e.id,
                  label: e.name,
                }))}
                placeholder="All Events"
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
              />
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={activeOnly}
                  onChange={(e) => setActiveOnly(e.target.checked)}
                  className="rounded border-neutral-300 text-siue-red focus:ring-siue-red"
                />
                <span className="text-sm text-neutral-700">Active contacts only</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeUnverified}
                  onChange={(e) => setIncludeUnverified(e.target.checked)}
                  className="rounded border-neutral-300 text-siue-red focus:ring-siue-red"
                />
                <span className="text-sm text-neutral-700">Include unverified contacts</span>
              </label>

              <div className="pt-4 border-t border-neutral-100">
                <Select
                  label="Export Format"
                  options={[
                    { value: 'email', label: 'Email List (clipboard)' },
                    { value: 'csv', label: 'Full CSV Export' },
                    { value: 'mailing', label: 'Mailing Labels' },
                  ]}
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as 'email' | 'csv' | 'mailing')}
                />
              </div>

              <Button className="w-full" onClick={handleExport} disabled={filteredContacts.length === 0}>
                {exportFormat === 'email' ? <Copy size={16} /> : <Download size={16} />}
                {exportFormat === 'email'
                  ? 'Copy Emails'
                  : exportFormat === 'csv'
                  ? 'Download CSV'
                  : 'Download Labels'}
              </Button>

              {(countyFilter || roleFilter || schoolTypeFilter || eventFilter) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setCountyFilter('');
                    setRoleFilter('');
                    setSchoolTypeFilter('');
                    setEventFilter('');
                  }}
                >
                  Clear All Filters
                </Button>
              )}
            </div>
          </Card>

          {/* Preview */}
          <Card className="lg:col-span-2" padding={false}>
            <div className="px-6 py-4 border-b border-neutral-100">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-neutral-800">
                  Preview ({filteredContacts.length.toLocaleString()} contacts)
                </h3>
                <div className="flex gap-2">
                  {countyFilter && <Badge><MapPin size={12} className="mr-1" />{countyChoiceLabel(countyFilter)}</Badge>}
                  {roleFilter && <Badge variant="info">{ContactRoleLabels[roleFilter as ContactRole]}</Badge>}
                </div>
              </div>
            </div>
            <DataTable
              data={filteredContacts}
              columns={previewColumns}
              columnWidths={['20%', '26%', '15%', '25%', '14%']}
              emptyMessage="No contacts match your filters. Adjust them to find contacts."
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
