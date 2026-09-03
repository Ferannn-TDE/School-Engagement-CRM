import { useMemo, Fragment } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { format, subMonths, isAfter } from 'date-fns';
import {
  Download, AlertTriangle, TrendingUp, School, Users, Calendar,
  BarChart3, Activity, ArrowRight,
} from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card, MetricCard } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { useEngagementMaps, useSchoolsNeedingAttention } from '../hooks/useEngagementMaps';
import { EventTypeLabels } from '../types';
import type { EventType } from '../types';
import { CHART_COLORS, TOOLTIP_CLS } from '../constants/charts';
import { downloadFile } from '../utils/helpers';
import toast from 'react-hot-toast';


function formatActivityType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}


// Custom tooltip for the Top Engaged Schools chart
function EngagementTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { fullName: string; score: number; acts: number; contacts: number; events: number } }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className={TOOLTIP_CLS}>
      <p className="font-semibold text-neutral-800 mb-2 max-w-[200px]">{d.fullName}</p>
      <div className="space-y-1 text-neutral-600">
        <p>Activities: <span className="font-medium text-neutral-800">{d.acts}</span></p>
        <p>Active Contacts: <span className="font-medium text-neutral-800">{d.contacts}</span></p>
        <p>Event appearances: <span className="font-medium text-neutral-800">{d.events}</span></p>
      </div>
      <p className="mt-2 font-semibold text-siue-red">Score: {d.score}</p>
    </div>
  );
}

// Tooltip for Events by Type pie chart
function PieEventTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { name: string; value: number; attendees: number } }>;
}) {
  if (!active || !payload?.[0]) return null;
  const item = payload[0];
  return (
    <div className={TOOLTIP_CLS}>
      <p className="font-semibold text-neutral-800 mb-1.5 max-w-[160px]">{item.payload.name}</p>
      <p className="text-neutral-600">Events: <span className="font-medium text-neutral-800">{item.value}</span></p>
      {item.payload.attendees > 0 && (
        <p className="text-neutral-600 mt-0.5">Attendees: <span className="font-medium text-neutral-800">{item.payload.attendees.toLocaleString()}</span></p>
      )}
    </div>
  );
}

export function ReportsPage() {
  const { state, schoolContactsMap, schoolActivitiesMap, schoolEventCountMap } = useEngagementMaps();
  const schoolsNeedingAttention = useSchoolsNeedingAttention();

  // ── Summary metrics ──────────────────────────────────────────────────────────
  const summaryMetrics = useMemo(() => {
    const sixMonthsAgo = subMonths(new Date(), 6);
    let schoolsEngaged = 0;
    let schoolsNeedingCount = 0;
    for (const s of state.schools) {
      const acts = schoolActivitiesMap.get(s.id);
      if (acts && acts.count > 0) {
        schoolsEngaged++;
        if (acts.latestDate && !isAfter(acts.latestDate, sixMonthsAgo)) schoolsNeedingCount++;
      } else {
        schoolsNeedingCount++;
      }
    }
    return {
      totalSchools: state.schools.length,
      totalContacts: [...schoolContactsMap.values()].reduce((sum, v) => sum + v.active, 0),
      totalEvents: state.events.length,
      schoolsEngaged,
      schoolsNeedingAttention: schoolsNeedingCount,
      totalAttendees: state.events.reduce((acc, e) => acc + (e.attendeeCount ?? 0), 0),
    };
  }, [state.schools, state.events, schoolActivitiesMap, schoolContactsMap]);

  // ── Engagement pipeline (funnel) ─────────────────────────────────────────────
  const engagementPipeline = useMemo(() => {
    const total = state.schools.length;
    const sixMonthsAgo = subMonths(new Date(), 6);
    let withContacts = 0, withRecentActivity = 0, atEvents = 0;
    for (const s of state.schools) {
      if ((schoolContactsMap.get(s.id)?.total ?? 0) > 0) withContacts++;
      const acts = schoolActivitiesMap.get(s.id);
      if (acts?.latestDate && isAfter(acts.latestDate, sixMonthsAgo)) withRecentActivity++;
      if ((schoolEventCountMap.get(s.id) ?? 0) > 0) atEvents++;
    }
    return [
      { label: 'Total Schools', count: total, color: '#54585A', icon: <School size={16} /> },
      { label: 'With Contacts', count: withContacts, color: '#004B87', icon: <Users size={16} /> },
      { label: 'Active (6 mo)', count: withRecentActivity, color: '#0F7837', icon: <Activity size={16} /> },
      { label: 'At Events', count: atEvents, color: '#CE1126', icon: <Calendar size={16} /> },
    ];
  }, [state.schools, schoolContactsMap, schoolActivitiesMap, schoolEventCountMap]);

  // ── Top engaged schools (composite score) ────────────────────────────────────
  const topEngagedSchools = useMemo(() => {
    return state.schools
      .map((s) => {
        const acts = schoolActivitiesMap.get(s.id)?.count ?? 0;
        const contacts = schoolContactsMap.get(s.id)?.active ?? 0;
        const events = schoolEventCountMap.get(s.id) ?? 0;
        const score = acts * 3 + contacts * 2 + events * 4;
        return {
          name: s.name.length > 22 ? s.name.slice(0, 20) + '…' : s.name,
          fullName: s.name,
          score, acts, contacts, events,
        };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }, [state.schools, schoolActivitiesMap, schoolContactsMap, schoolEventCountMap]);

  // ── Event type distribution (enhanced with attendance) ───────────────────────
  const eventTypeData = useMemo(() => {
    const counts: Record<string, { count: number; attendees: number }> = {};
    for (const event of state.events) {
      if (!counts[event.type]) counts[event.type] = { count: 0, attendees: 0 };
      counts[event.type].count++;
      counts[event.type].attendees += event.attendeeCount ?? 0;
    }
    return Object.entries(counts).map(([type, { count, attendees }]) => ({
      name: EventTypeLabels[type as EventType],
      value: count, attendees,
    }));
  }, [state.events]);

  // ── Recent activity feed ─────────────────────────────────────────────────────
  const recentActivityFeed = useMemo(() => {
    const schoolMap = new Map(state.schools.map((s) => [s.id, s]));
    return [...state.activities]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 12)
      .map((a) => ({
        id: a.id,
        school: schoolMap.get(a.schoolId),
        schoolId: a.schoolId,
        date: a.date,
        description: a.description,
        activityType: a.activityType,
      }));
  }, [state.activities, state.schools]);

  // ── Export ───────────────────────────────────────────────────────────────────
  const handleExportReport = () => {
    const lines = [
      'SIUE School of Engineering — K-12 Outreach CRM Report',
      `Generated: ${format(new Date(), 'MMMM d, yyyy')}`,
      '',
      '=== SUMMARY ===',
      `Total Schools: ${summaryMetrics.totalSchools}`,
      `Active Contacts: ${summaryMetrics.totalContacts}`,
      `Total Events: ${summaryMetrics.totalEvents}`,
      `Schools Engaged (with activity): ${summaryMetrics.schoolsEngaged}`,
      `Total Event Attendees: ${summaryMetrics.totalAttendees}`,
      '',
      '=== TOP ENGAGED SCHOOLS ===',
      'School,Score,Activities,Active Contacts,Events Appeared',
      ...topEngagedSchools.map((s) => `"${s.fullName}",${s.score},${s.acts},${s.contacts},${s.events}`),
      '',
      '=== SCHOOLS NEEDING ATTENTION ===',
      'School,County,Contacts,Last Activity,Priority,Issues',
      ...schoolsNeedingAttention.map(
        (s) => `"${s.name}",${s.county},${s.contactCount},${s.lastActivity},${s.severity},"${s.issues.join('; ')}"`
      ),
    ];
    downloadFile(lines.join('\n'), `siue-crm-report-${format(new Date(), 'yyyy-MM-dd')}.csv`);
    toast.success('Report exported');
  };

  const total = engagementPipeline[0]?.count ?? 1;
  const missingCountyCount = state.schools.filter((s) => !s.county || !s.county.trim()).length;

  return (
    <div>
<Header
        title="Reports"
        subtitle="How your K-12 engagement program is tracking"
        actions={
          <Button size="sm" onClick={handleExportReport}>
            <Download size={16} />
            Export Report
          </Button>
        }
      />
      <div className="p-8 space-y-8">

        {/* ── Summary metrics ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCard title="Total Schools" value={summaryMetrics.totalSchools} icon={<School size={20} />} />
          <MetricCard title="Active Contacts" value={summaryMetrics.totalContacts} icon={<Users size={20} />} />
          <MetricCard title="Total Events" value={summaryMetrics.totalEvents} icon={<Calendar size={20} />} />
          <MetricCard title="Schools Engaged" value={summaryMetrics.schoolsEngaged} icon={<TrendingUp size={20} />} />
          <MetricCard title="Total Attendees" value={summaryMetrics.totalAttendees.toLocaleString()} icon={<Users size={20} />} />
          <MetricCard title="Need Attention" value={summaryMetrics.schoolsNeedingAttention} icon={<AlertTriangle size={20} />} />
        </div>

        {/* ── Engagement Pipeline ───────────────────────────────────────────── */}
        <Card>
          <div className="mb-5">
            <h3 className="text-base font-semibold text-neutral-800">Engagement Pipeline</h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              Where schools stand in your outreach funnel — each stage as a % of all schools.
            </p>
          </div>
          <div className="flex items-stretch gap-2">
            {engagementPipeline.map((step, i) => (
              <Fragment key={step.label}>
                {i > 0 && (
                  <div className="flex items-center shrink-0">
                    <ArrowRight size={16} className="text-neutral-300" />
                  </div>
                )}
                <div className="flex-1 min-w-0 p-4 rounded-xl bg-neutral-50 border border-neutral-100">
                  <div className="flex items-center gap-2 mb-2" style={{ color: step.color }}>
                    {step.icon}
                    <p className="text-xs font-medium text-neutral-500">{step.label}</p>
                  </div>
                  <p className="text-2xl font-bold text-neutral-800">{step.count.toLocaleString()}</p>
                  <p className="text-xs text-neutral-500 mt-0.5 mb-3">
                    {i === 0 ? 'baseline' : `${Math.round((step.count / total) * 100)}% of total`}
                  </p>
                  <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${total > 0 ? Math.round((step.count / total) * 100) : 0}%`,
                        backgroundColor: step.color,
                      }}
                    />
                  </div>
                </div>
              </Fragment>
            ))}
          </div>
        </Card>

        {/* ── Data quality notice ───────────────────────────────────────────── */}
        {missingCountyCount > 0 && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            <AlertTriangle size={14} className="shrink-0 text-amber-500" />
            <span>
              <span className="font-semibold">{missingCountyCount} school{missingCountyCount !== 1 ? 's' : ''}</span>{' '}
              {missingCountyCount !== 1 ? 'have' : 'has'} no county assigned and {missingCountyCount !== 1 ? 'are' : 'is'} excluded from county-level analytics below.
              Visit the Schools page to update their county data.
            </span>
          </div>
        )}

        {/* ── Top Engaged Schools ──────────────────────────────────────────── */}
        <div>
          <Card>
            <h3 className="text-base font-semibold text-neutral-800 mb-1">Top Engaged Schools</h3>
            <p className="text-xs text-neutral-500 mb-4">Composite score: activities ×3 + active contacts ×2 + event appearances ×4</p>
            {topEngagedSchools.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={topEngagedSchools} layout="vertical" margin={{ left: 0, right: 24, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8E9EA" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#8A8D8F' }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: '#8A8D8F' }} width={160} />
                  <Tooltip content={<EngagementTooltip />} />
                  <Bar dataKey="score" fill="#CE1126" radius={[0, 4, 4, 0]} name="Engagement Score" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <BarChart3 size={28} className="text-neutral-300 mb-3" />
                <p className="text-sm font-medium text-neutral-500">No engagement data yet</p>
                <p className="text-xs text-neutral-500 mt-1">Add contacts, log activities, and link schools to events.</p>
              </div>
            )}
          </Card>

        </div>

        {/* ── Events by Type ───────────────────────────────────────────────── */}
        <div>
          <Card>
            <h3 className="text-base font-semibold text-neutral-800 mb-4">Events by Type</h3>
            {eventTypeData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={eventTypeData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={85}
                      dataKey="value"
                      paddingAngle={3}
                    >
                      {eventTypeData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieEventTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-3 space-y-2">
                  {eventTypeData.map((item, i) => (
                    <div key={item.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="text-neutral-600 text-xs">{item.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-medium text-neutral-800">{item.value} event{item.value !== 1 ? 's' : ''}</span>
                        {item.attendees > 0 && (
                          <span className="text-xs text-neutral-500 ml-1">· {item.attendees.toLocaleString()} attendees</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-neutral-400 text-sm py-12 text-center">No events yet.</p>
            )}
          </Card>

        </div>

        {/* ── Recent Activity Feed ─────────────────────────────────────────── */}
        <div>
          <Card>
            <h3 className="text-base font-semibold text-neutral-800 flex items-center gap-2 mb-4">
              <Activity size={15} className="text-neutral-400" />
              Recent Activity Feed
            </h3>
            {recentActivityFeed.length > 0 ? (
              <div className="space-y-0 divide-y divide-neutral-50">
                {recentActivityFeed.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 py-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-siue-red mt-2 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <Link
                          to={`/schools/${encodeURIComponent(a.schoolId)}`}
                          className="text-sm font-medium text-neutral-800 hover:text-siue-red transition-colors truncate"
                        >
                          {a.school?.name ?? 'Unknown School'}
                        </Link>
                        <Badge variant="default">{formatActivityType(a.activityType)}</Badge>
                      </div>
                      <p className="text-xs text-neutral-500 line-clamp-1">{a.description}</p>
                      <p className="text-xs text-neutral-500 mt-0.5">{format(new Date(a.date), 'MMM d, yyyy')}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center">
                <Activity size={28} className="mx-auto mb-3 text-neutral-300" />
                <p className="text-sm font-medium text-neutral-500">No activities logged yet</p>
                <p className="text-xs text-neutral-500 mt-1">Activities appear here once logged from a school's detail page.</p>
              </div>
            )}
          </Card>

        </div>



      </div>
    </div>
  );
}
