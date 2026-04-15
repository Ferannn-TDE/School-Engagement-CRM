import { useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  School, Users, Calendar, TrendingUp, Upload, ArrowRight,
  AlertTriangle, List, Activity,
} from 'lucide-react';
import { format, isAfter, subMonths } from 'date-fns';
import { Header } from '../components/layout/Header';
import { MetricCard, Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { useAppContext } from '../context/AppContext';
import { EventTypeLabels } from '../types';
import type { EventType } from '../types';

const EVENT_TYPE_VARIANT: Record<string, 'info' | 'success' | 'warning' | 'default'> = {
  outreach_fair: 'info',
  campus_visit: 'success',
  recruitment_event: 'warning',
  summer_camp: 'info',
  workshop: 'default',
  other: 'default',
};

const QUICK_ACTIONS = [
  { label: 'Import Contacts', description: 'Bulk import from CSV or Excel', icon: Upload, path: '/import' },
  { label: 'Create Event', description: 'Log a new outreach event', icon: Calendar, path: '/events' },
  { label: 'Log Activity', description: 'Browse schools to record activity', icon: Activity, path: '/schools' },
  { label: 'Generate List', description: 'Build mailing or email lists', icon: List, path: '/generate' },
] as const;

export function DashboardPage() {
  const { state } = useAppContext();
  const navigate = useNavigate();

  const metrics = useMemo(() => {
    const now = new Date();
    const yearAgo = subMonths(now, 12);
    return {
      activeSchools: state.schools.filter((s) => s.isActive).length,
      activeContacts: state.contacts.filter((c) => c.isActive).length,
      upcomingEvents: state.events.filter((e) => isAfter(new Date(e.date), now)).length,
      recentActivities: state.activities.filter((a) => isAfter(new Date(a.date), yearAgo)).length,
    };
  }, [state]);

  // Single O(n) pass over contacts + activities for all derived stats
  const dashboardComputed = useMemo(() => {
    const now = new Date();
    const sixMonthsAgo = subMonths(now, 6);
    const total = state.schools.length;

    const contactsMap = new Map<string, number>();
    for (const c of state.contacts) {
      contactsMap.set(c.schoolId, (contactsMap.get(c.schoolId) ?? 0) + 1);
    }

    const activityMap = new Map<string, Date>();
    for (const a of state.activities) {
      const d = new Date(a.date);
      const ex = activityMap.get(a.schoolId);
      if (!ex || d > ex) activityMap.set(a.schoolId, d);
    }

    let withContacts = 0;
    let withRecentActivity = 0;
    for (const s of state.schools) {
      if ((contactsMap.get(s.id) ?? 0) > 0) withContacts++;
      const last = activityMap.get(s.id);
      if (last && isAfter(last, sixMonthsAgo)) withRecentActivity++;
    }

    const avgContacts = total > 0 ? (state.contacts.length / total).toFixed(1) : '0.0';

    const topAttention = state.schools
      .map((s) => {
        const contacts = contactsMap.get(s.id) ?? 0;
        const lastActivity = activityMap.get(s.id) ?? null;
        const issues: string[] = [];
        if (contacts === 0) issues.push('No contacts');
        if (!lastActivity) issues.push('No activity');
        else if (!isAfter(lastActivity, sixMonthsAgo)) issues.push('Activity stale (6+ mo)');
        return { id: s.id, name: s.name, county: s.county, contacts, issues };
      })
      .filter((s) => s.issues.length > 0)
      .sort((a, b) => b.issues.length - a.issues.length || a.name.localeCompare(b.name))
      .slice(0, 5);

    return { total, withContacts, withRecentActivity, avgContacts, topAttention };
  }, [state.schools, state.contacts, state.activities]);

  const upcomingEvents = useMemo(
    () =>
      state.events
        .filter((e) => isAfter(new Date(e.date), new Date()))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(0, 6),
    [state.events]
  );

  return (
    <div>
<Header
        title="Dashboard"
        subtitle="Overview of your K-12 engagement program"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/import')}>
            <Upload size={16} />
            Import
          </Button>
        }
      />
      <div className="p-8 space-y-8">

        {/* ── Metric Cards ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard
            title="Active Schools"
            value={metrics.activeSchools}
            subtitle={`${state.schools.length} total`}
            icon={<School size={20} />}
          />
          <MetricCard
            title="Active Contacts"
            value={metrics.activeContacts}
            subtitle={`${state.contacts.length} total`}
            icon={<Users size={20} />}
          />
          <MetricCard
            title="Upcoming Events"
            value={metrics.upcomingEvents}
            subtitle={`${state.events.length} total`}
            icon={<Calendar size={20} />}
          />
          {/* Activities — CTA when empty */}
          {metrics.recentActivities === 0 ? (
            <Card>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-500">Activities (12 mo)</p>
                  <p className="mt-1 text-3xl font-bold text-neutral-800">0</p>
                  <Link
                    to="/schools"
                    className="mt-2 inline-flex items-center gap-1 text-sm text-siue-red hover:text-siue-maroon font-medium transition-colors"
                  >
                    Log your first activity <ArrowRight size={13} />
                  </Link>
                </div>
                <div className="p-3 rounded-lg bg-siue-red/10 text-siue-red shrink-0">
                  <TrendingUp size={20} />
                </div>
              </div>
            </Card>
          ) : (
            <MetricCard
              title="Activities (12 mo)"
              value={metrics.recentActivities}
              subtitle={`${state.activities.length} all time`}
              icon={<TrendingUp size={20} />}
            />
          )}
        </div>

        {/* ── Engagement Overview ───────────────────────────────────────────── */}
        <Card>
          <h3 className="text-sm font-semibold text-neutral-700 mb-5">Engagement Overview</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-neutral-100">
            <div className="pb-4 sm:pb-0 sm:pr-8">
              <p className="text-xs text-neutral-400 uppercase tracking-wider mb-1">Schools with Contacts</p>
              <p className="text-2xl font-bold text-neutral-800">
                {dashboardComputed.withContacts}
                <span className="text-base font-normal text-neutral-400">/{dashboardComputed.total}</span>
              </p>
              <div className="mt-2 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-info rounded-full transition-all duration-700"
                  style={{ width: `${dashboardComputed.total > 0 ? Math.round((dashboardComputed.withContacts / dashboardComputed.total) * 100) : 0}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-neutral-400">
                {dashboardComputed.total > 0 ? Math.round((dashboardComputed.withContacts / dashboardComputed.total) * 100) : 0}% reached
              </p>
            </div>
            <div className="py-4 sm:py-0 sm:px-8">
              <p className="text-xs text-neutral-400 uppercase tracking-wider mb-1">With Recent Activity</p>
              <p className="text-2xl font-bold text-neutral-800">
                {dashboardComputed.withRecentActivity}
                <span className="text-base font-normal text-neutral-400">/{dashboardComputed.total}</span>
              </p>
              <div className="mt-2 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-success rounded-full transition-all duration-700"
                  style={{ width: `${dashboardComputed.total > 0 ? Math.round((dashboardComputed.withRecentActivity / dashboardComputed.total) * 100) : 0}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-neutral-400">
                {dashboardComputed.total > 0 ? Math.round((dashboardComputed.withRecentActivity / dashboardComputed.total) * 100) : 0}% active (6 mo)
              </p>
            </div>
            <div className="pt-4 sm:pt-0 sm:pl-8">
              <p className="text-xs text-neutral-400 uppercase tracking-wider mb-1">Avg Contacts / School</p>
              <p className="text-2xl font-bold text-neutral-800">{dashboardComputed.avgContacts}</p>
              <div className="mt-2 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-siue-red rounded-full"
                  style={{ width: `${Math.min(100, parseFloat(dashboardComputed.avgContacts) * 20)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-neutral-400">
                {state.contacts.length} contacts across {dashboardComputed.total} schools
              </p>
            </div>
          </div>
        </Card>

        {/* ── Quick Actions + Upcoming Events ──────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quick Actions */}
          <Card>
            <h3 className="text-sm font-semibold text-neutral-700 mb-4">Quick Actions</h3>
            <div className="space-y-2">
              {QUICK_ACTIONS.map(({ label, description, icon: Icon, path }) => (
                <button
                  key={path}
                  onClick={() => navigate(path)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-neutral-100 hover:border-siue-red/30 hover:bg-siue-red/5 transition-colors text-left group"
                >
                  <div className="p-2 rounded-lg bg-siue-red/10 text-siue-red shrink-0 group-hover:bg-siue-red group-hover:text-white transition-colors">
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-800">{label}</p>
                    <p className="text-xs text-neutral-400 truncate">{description}</p>
                  </div>
                  <ArrowRight size={14} className="text-neutral-300 group-hover:text-siue-red shrink-0 ml-auto transition-colors" />
                </button>
              ))}
            </div>
          </Card>

          {/* Upcoming Events */}
          <Card className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-neutral-700">Upcoming Events</h3>
              <button
                onClick={() => navigate('/events')}
                className="text-sm text-siue-red hover:text-siue-maroon font-medium flex items-center gap-1 transition-colors"
              >
                View all <ArrowRight size={14} />
              </button>
            </div>
            {upcomingEvents.length > 0 ? (
              <div className="divide-y divide-neutral-50">
                {upcomingEvents.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between py-3 gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-neutral-800 truncate">{event.name}</p>
                      <p className="text-xs text-neutral-400 truncate mt-0.5">{event.location}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={EVENT_TYPE_VARIANT[event.type] ?? 'default'}>
                        {EventTypeLabels[event.type as EventType]}
                      </Badge>
                      <span className="text-xs font-medium text-neutral-600 whitespace-nowrap">
                        {format(new Date(event.date), 'MMM d, yyyy')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-10 text-center">
                <Calendar size={28} className="mx-auto mb-3 text-neutral-300" />
                <p className="text-sm text-neutral-500">No upcoming events.</p>
                <button
                  onClick={() => navigate('/events')}
                  className="mt-2 text-sm text-siue-red hover:text-siue-maroon font-medium transition-colors"
                >
                  Create an event →
                </button>
              </div>
            )}
          </Card>
        </div>

        {/* ── Schools Needing Attention (Top 5) ────────────────────────────── */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-neutral-700 flex items-center gap-2">
                <AlertTriangle size={15} className="text-warning" />
                Schools Needing Attention
              </h3>
              <p className="text-xs text-neutral-400 mt-0.5">Top 5 highest-priority schools from your engagement data.</p>
            </div>
            <Link
              to="/analytics"
              className="text-sm text-siue-red hover:text-siue-maroon font-medium flex items-center gap-1 transition-colors shrink-0"
            >
              View all <ArrowRight size={14} />
            </Link>
          </div>
          {dashboardComputed.topAttention.length > 0 ? (
            <div className="divide-y divide-neutral-50">
              {dashboardComputed.topAttention.map((school) => (
                <div key={school.id} className="flex items-center justify-between py-3 gap-4">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/schools/${encodeURIComponent(school.id)}`}
                      className="text-sm font-medium text-neutral-800 hover:text-siue-red transition-colors truncate block"
                    >
                      {school.name}
                    </Link>
                    <p className="text-xs text-neutral-400 mt-0.5">{school.county} County · {school.contacts} contact{school.contacts !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end shrink-0">
                    {school.issues.map((issue) => (
                      <Badge key={issue} variant={school.issues.length >= 2 ? 'error' : 'warning'}>
                        {issue}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <AlertTriangle size={28} className="mx-auto mb-3 text-success opacity-50" />
              <p className="text-sm font-medium text-success">All schools are in good standing.</p>
              <p className="text-xs text-neutral-400 mt-1">Every school has contacts and recent activity.</p>
            </div>
          )}
        </Card>

      </div>
    </div>
  );
}
