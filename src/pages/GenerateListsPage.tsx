import { useState, useMemo } from 'react';
import { Copy, Download, Mail, MapPin } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Select } from '../components/common/Select';
import { Badge } from '../components/common/Badge';
import { useAppContext } from '../context/AppContext';
import { ContactRole, ContactRoleLabels } from '../types';
import { contactsToCsv, downloadFile } from '../utils/helpers';
import toast from 'react-hot-toast';

export function GenerateListsPage() {
  const { state, getSchoolById } = useAppContext();
  const [countyFilter, setCountyFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [schoolTypeFilter, setSchoolTypeFilter] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [exportFormat, setExportFormat] = useState<'email' | 'csv' | 'mailing'>('email');

  const uniqueCounties = useMemo(
    () => [...new Set(state.schools.map((s) => s.county))].sort(),
    [state.schools]
  );

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
            if (countyFilter && s.county !== countyFilter) return false;
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
        role: ContactRoleLabels[c.role],
        school: school?.name || '',
        county: school?.county || '',
        address: school?.address || '',
        city: school?.city || '',
        state: school?.state || '',
        zipCode: school?.zipCode || '',
      };
    });
    const csv = contactsToCsv(
      rows,
      ['firstName', 'lastName', 'email', 'phone', 'role', 'school', 'county', 'address', 'city', 'state', 'zipCode']
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
            <h3 className="text-sm font-semibold text-neutral-700 mb-4">Filter Contacts</h3>
            <div className="space-y-4">
              <Select
                label="County"
                options={uniqueCounties.map((c) => ({ value: c, label: c }))}
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
                <h3 className="text-sm font-semibold text-neutral-700">
                  Preview ({filteredContacts.length} contacts)
                </h3>
                <div className="flex gap-2">
                  {countyFilter && <Badge><MapPin size={12} className="mr-1" />{countyFilter}</Badge>}
                  {roleFilter && <Badge variant="info">{ContactRoleLabels[roleFilter as ContactRole]}</Badge>}
                </div>
              </div>
            </div>
            {filteredContacts.length > 0 && (
              <div className="px-4 py-2 border-b border-neutral-100 text-xs text-neutral-500">
                Showing {Math.min(50, filteredContacts.length)} of {filteredContacts.length} contacts
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-100 text-sm table-fixed">
                <colgroup>
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '28%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '24%' }} />
                  <col style={{ width: '12%' }} />
                </colgroup>
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wider">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wider">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wider">Role</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wider">School</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wider">County</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50">
                  {filteredContacts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-neutral-400">
                        <Mail size={32} className="mx-auto mb-2 opacity-50" />
                        <p>No contacts match your filters.</p>
                        <p className="text-xs mt-1">Adjust your filters to find contacts.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredContacts.slice(0, 50).map((contact) => {
                      const school = getSchoolById(contact.schoolId);
                      return (
                        <tr key={contact.id} className="hover:bg-neutral-50">
                          <td className="px-4 py-3 text-neutral-700 font-medium">
                            {contact.firstName} {contact.lastName}
                          </td>
                          <td className="px-4 py-3 text-neutral-500">{contact.email}</td>
                          <td className="px-4 py-3">
                            <Badge variant="info">{ContactRoleLabels[contact.role]}</Badge>
                          </td>
                          <td className="px-4 py-3 text-neutral-600">{school?.name || '-'}</td>
                          <td className="px-4 py-3 text-neutral-500">{school?.county || '-'}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              {filteredContacts.length > 50 && (
                <p className="text-xs text-neutral-400 p-3 text-center bg-neutral-50">
                  Showing first 50 of {filteredContacts.length} contacts
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
