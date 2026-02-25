import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { format, getYear, getMonth, parseISO, subMonths, isAfter } from 'date-fns';
import { BarChart3, Download, AlertTriangle, TrendingUp, School, Users, Calendar } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card, MetricCard } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { useAppContext } from '../context/AppContext';
import { EventTypeLabels } from '../types';
import type { EventType } from '../types';
import { downloadFile } from '../utils/helpers';
import toast from 'react-hot-toast';

const CHART_COLORS = ['#CE1126', '#004B87', '#0F7837', '#FF8C00', '#8B2332', '#54585A', '#C41E3A', '#373A3C'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function AnalyticsPage() {
  const { state, getContactsBySchool, getActivitiesBySchool } = useAppContext();
  // ── Summary metrics ─────────────────────────────────────────────────────────
  const summaryMetrics = useMemo(() => {
    const now = new Date();
    const sixMonthsAgo = subMonths(now, 6);
    const schoolsWithActivity = new Set(state.activities.map((a) => a.schoolId));
    const schoolsNeedingAttention = state.schools.filter((s) => {
      const schoolActivities = state.activities.filter((a) => a.schoolId === s.id);
      if (schoolActivities.length === 0) return true;
      const latestDate = new Date(
        Math.max(...schoolActivities.map((a) => new Date(a.date).getTime()))
      );
      return !isAfter(latestDate, sixMonthsAgo);
    });
    return {
      totalSchools: state.schools.length,
      totalContacts: state.contacts.filter((c) => c.isActive).length,
      totalEvents: state.events.length,
      schoolsEngaged: schoolsWithActivity.size,
      schoolsNeedingAttention: schoolsNeedingAttention.length,
      totalAttendees: state.events.reduce((acc, e) => acc + (e.attendeeCount || 0), 0),
    };
  }, [state]);

  // ── Activity by school (top 12) ──────────────────────────────────────────────
  const activityBySchool = useMemo(() => {
    return state.schools
      .map((s) => ({
        name: s.name.length > 28 ? s.name.slice(0, 26) + '…' : s.name,
        fullName: s.name,
        activities: getActivitiesBySchool(s.id).length,
        contacts: getContactsBySchool(s.id).length,
        county: s.county,
      }))
      .filter((s) => s.activities > 0)
      .sort((a, b) => b.activities - a.activities)
      .slice(0, 12);
  }, [state.schools, getActivitiesBySchool, getContactsBySchool]);

  // ── Activity by county ────────────────────────────────────────────────────────
  const activityByCounty = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const activity of state.activities) {
      const school = state.schools.find((s) => s.id === activity.schoolId);
      if (school) {
        counts[school.county] = (counts[school.county] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([county, activities]) => ({ county, activities }))
      .sort((a, b) => b.activities - a.activities);
  }, [state.activities, state.schools]);

  // ── Monthly trend data (all years) ───────────────────────────────────────────
  const availableYears = useMemo(() => {
    const years = new Set(
      state.activities.map((a) => getYear(parseISO(a.date)))
    );
    return Array.from(years).sort();
  }, [state.activities]);

  const monthlyTrend = useMemo(() => {
    const allYears = availableYears;
    return MONTHS.map((month, monthIdx) => {
      const entry: Record<string, string | number> = { month };
      for (const year of allYears) {
        entry[String(year)] = state.activities.filter((a) => {
          const d = parseISO(a.date);
          return getYear(d) === year && getMonth(d) === monthIdx;
        }).length;
      }
      return entry;
    });
  }, [state.activities, availableYears]);

  // ── Event type distribution ───────────────────────────────────────────────────
  const eventTypeData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const event of state.events) {
      counts[event.type] = (counts[event.type] || 0) + 1;
    }
    return Object.entries(counts).map(([type, count]) => ({
      name: EventTypeLabels[type as EventType],
      value: count,
    }));
  }, [state.events]);

  // ── Schools needing attention ─────────────────────────────────────────────────
  const schoolsNeedingAttention = useMemo(() => {
    const sixMonthsAgo = subMonths(new Date(), 6);
    return state.schools
      .map((school) => {
        const activities = getActivitiesBySchool(school.id);
        const contacts = getContactsBySchool(school.id);
        const activeContacts = contacts.filter((c) => c.isActive);
        const latestActivityDate =
          activities.length > 0
            ? new Date(Math.max(...activities.map((a) => new Date(a.date).getTime())))
            : null;

        const issues: string[] = [];
        if (contacts.length === 0) issues.push('No contacts');
        else if (activeContacts.length === 0) issues.push('No active contacts');
        if (activities.length === 0) issues.push('No activity recorded');
        else if (!isAfter(latestActivityDate!, sixMonthsAgo))
          issues.push('No activity in 6+ months');

        return {
          id: school.id,
          name: school.name,
          county: school.county,
          type: school.schoolType,
          contactCount: contacts.length,
          activityCount: activities.length,
          lastActivity: latestActivityDate
            ? format(latestActivityDate, 'MMM d, yyyy')
            : 'Never',
          issues,
          priority: issues.length >= 2 ? 'high' : issues.length === 1 ? 'medium' : 'low',
        };
      })
      .filter((s) => s.issues.length > 0)
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.priority as keyof typeof order] - order[b.priority as keyof typeof order];
      });
  }, [state.schools, getActivitiesBySchool, getContactsBySchool]);

  // ── Export report ─────────────────────────────────────────────────────────────
  const handleExportReport = () => {
    const lines: string[] = [
      'SIUE School of Engineering — K-12 Outreach CRM Report',
      `Generated: ${format(new Date(), 'MMMM d, yyyy')}`,
      '',
      '=== SUMMARY ===',
      `Total Schools: ${summaryMetrics.totalSchools}`,
      `Active Contacts: ${summaryMetrics.totalContacts}`,
      `Total Events: ${summaryMetrics.totalEvents}`,
      `Schools with Engagement: ${summaryMetrics.schoolsEngaged}`,
      `Total Attendees (all events): ${summaryMetrics.totalAttendees}`,
      '',
      '=== ACTIVITY BY SCHOOL ===',
      'School,County,Activities,Contacts',
      ...activityBySchool.map((s) => `"${s.fullName}",${s.county},${s.activities},${s.contacts}`),
      '',
      '=== ACTIVITY BY COUNTY ===',
      'County,Activities',
      ...activityByCounty.map((c) => `${c.county},${c.activities}`),
      '',
      '=== SCHOOLS NEEDING ATTENTION ===',
      'School,County,Last Activity,Issues',
      ...schoolsNeedingAttention.map(
        (s) => `"${s.name}",${s.county},${s.lastActivity},"${s.issues.join('; ')}"`
      ),
    ];
    downloadFile(lines.join('\n'), `siue-crm-report-${format(new Date(), 'yyyy-MM-dd')}.csv`);
    toast.success('Report exported successfully');
  };

  const yearColors: Record<string, string> = {};
  availableYears.forEach((year, i) => {
    yearColors[String(year)] = CHART_COLORS[i % CHART_COLORS.length];
  });

  return (
    <div>
      <Header
        title="Analytics & Reports"
        subtitle="Insights into your K-12 engagement program"
        actions={
          <Button size="sm" onClick={handleExportReport}>
            <Download size={16} />
            Export Report
          </Button>
        }
      />
      <div className="p-8 space-y-8">

        {/* Summary metrics */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCard title="Total Schools" value={summaryMetrics.totalSchools} icon={<School size={20} />} />
          <MetricCard title="Active Contacts" value={summaryMetrics.totalContacts} icon={<Users size={20} />} />
          <MetricCard title="Total Events" value={summaryMetrics.totalEvents} icon={<Calendar size={20} />} />
          <MetricCard title="Schools Engaged" value={summaryMetrics.schoolsEngaged} icon={<TrendingUp size={20} />} />
          <MetricCard title="Total Attendees" value={summaryMetrics.totalAttendees.toLocaleString()} icon={<Users size={20} />} />
          <MetricCard title="Need Attention" value={summaryMetrics.schoolsNeedingAttention} icon={<AlertTriangle size={20} />} />
        </div>

        {/* Monthly activity trend */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-neutral-700">Monthly Activity Trends (Year-over-Year)</h3>
          </div>
          {state.activities.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={monthlyTrend} margin={{ left: 0, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E9EA" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                {availableYears.map((year) => (
                  <Line
                    key={year}
                    type="monotone"
                    dataKey={String(year)}
                    stroke={yearColors[String(year)]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-neutral-400 text-sm py-12 text-center">No activity data yet.</p>
          )}
        </Card>

        {/* Activity by School + County */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <h3 className="text-sm font-semibold text-neutral-700 mb-4">Activity by School (Top 12)</h3>
            {activityBySchool.length > 0 ? (
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={activityBySchool} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8E9EA" />
                  <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={175} />
                  <Tooltip
                    formatter={(value, name) => [value, name === 'activities' ? 'Activities' : name]}
                    labelFormatter={(label) =>
                      activityBySchool.find((s) => s.name === label)?.fullName || label
                    }
                  />
                  <Bar dataKey="activities" fill="#CE1126" radius={[0, 4, 4, 0]} name="Activities" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-neutral-400 text-sm py-12 text-center">No data yet.</p>
            )}
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-neutral-700 mb-4">Activity by County</h3>
            {activityByCounty.length > 0 ? (
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={activityByCounty} layout="vertical" margin={{ left: 0, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8E9EA" />
                  <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <YAxis dataKey="county" type="category" tick={{ fontSize: 12 }} width={80} />
                  <Tooltip />
                  <Bar dataKey="activities" fill="#004B87" radius={[0, 4, 4, 0]} name="Activities" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-neutral-400 text-sm py-12 text-center">No data yet.</p>
            )}
          </Card>
        </div>

        {/* Event type distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card>
            <h3 className="text-sm font-semibold text-neutral-700 mb-4">Events by Type</h3>
            {eventTypeData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={eventTypeData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
                      dataKey="value"
                      paddingAngle={3}
                    >
                      {eventTypeData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v, n) => [v, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 space-y-1.5">
                  {eventTypeData.map((item, i) => (
                    <div key={item.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                        />
                        <span className="text-neutral-600">{item.name}</span>
                      </div>
                      <span className="font-medium text-neutral-800">{item.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-neutral-400 text-sm py-12 text-center">No events yet.</p>
            )}
          </Card>

          {/* Schools per county (engagement breadth) */}
          <Card className="lg:col-span-2">
            <h3 className="text-sm font-semibold text-neutral-700 mb-4">School Coverage by County</h3>
            {state.schools.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={Object.entries(
                    state.schools.reduce<Record<string, { total: number; engaged: number }>>((acc, s) => {
                      if (!acc[s.county]) acc[s.county] = { total: 0, engaged: 0 };
                      acc[s.county].total += 1;
                      const hasActivity = state.activities.some((a) => a.schoolId === s.id);
                      if (hasActivity) acc[s.county].engaged += 1;
                      return acc;
                    }, {})
                  )
                    .map(([county, counts]) => ({ county, ...counts }))
                    .sort((a, b) => b.total - a.total)}
                  margin={{ left: 0, right: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8E9EA" />
                  <XAxis dataKey="county" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="total" fill="#D1D3D4" name="Total Schools" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="engaged" fill="#CE1126" name="Engaged Schools" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-neutral-400 text-sm py-12 text-center">No schools added yet.</p>
            )}
          </Card>
        </div>

        {/* Schools needing attention */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-neutral-700 flex items-center gap-2">
                <AlertTriangle size={16} className="text-warning" />
                Schools Needing Attention
              </h3>
              <p className="text-xs text-neutral-400 mt-0.5">
                Schools with no contacts, no activity recorded, or no activity in the last 6 months.
              </p>
            </div>
            <Badge variant={schoolsNeedingAttention.length === 0 ? 'success' : 'warning'}>
              {schoolsNeedingAttention.length} school{schoolsNeedingAttention.length !== 1 ? 's' : ''}
            </Badge>
          </div>

          {schoolsNeedingAttention.length === 0 ? (
            <div className="text-center py-10">
              <BarChart3 size={32} className="mx-auto mb-3 text-success opacity-50" />
              <p className="text-sm font-medium text-success">All schools are in good standing.</p>
              <p className="text-xs text-neutral-400 mt-1">Every school has active contacts and recent engagement.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-100 text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wider">School</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wider">County</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wider">Contacts</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wider">Last Activity</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wider">Issues</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wider">Priority</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50 bg-white">
                  {schoolsNeedingAttention.map((school) => (
                    <tr key={school.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 font-medium text-neutral-800">{school.name}</td>
                      <td className="px-4 py-3 text-neutral-500">{school.county}</td>
                      <td className="px-4 py-3 text-neutral-500">{school.contactCount}</td>
                      <td className="px-4 py-3 text-neutral-500">{school.lastActivity}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {school.issues.map((issue) => (
                            <Badge key={issue} variant="warning">{issue}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            school.priority === 'high'
                              ? 'error'
                              : school.priority === 'medium'
                              ? 'warning'
                              : 'default'
                          }
                        >
                          {school.priority.charAt(0).toUpperCase() + school.priority.slice(1)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
