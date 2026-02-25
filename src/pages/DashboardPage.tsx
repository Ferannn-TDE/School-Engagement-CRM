import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { School, Users, Calendar, TrendingUp, Plus, Upload, ArrowRight } from 'lucide-react';
import { format, isAfter, subMonths } from 'date-fns';
import { Header } from '../components/layout/Header';
import { MetricCard, Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { useAppContext } from '../context/AppContext';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const COUNTY_COLORS = ['#CE1126', '#8B2332', '#004B87', '#0F7837', '#FF8C00', '#54585A', '#373A3C', '#C41E3A'];

export function DashboardPage() {
  const { state, getSchoolById } = useAppContext();
  const navigate = useNavigate();

  const metrics = useMemo(() => {
    const now = new Date();
    const yearAgo = subMonths(now, 12);
    const activeSchools = state.schools.filter((s) => s.isActive).length;
    const activeContacts = state.contacts.filter((c) => c.isActive).length;
    const recentActivities = state.activities.filter((a) =>
      isAfter(new Date(a.date), yearAgo)
    ).length;
    const upcomingEvents = state.events.filter((e) =>
      isAfter(new Date(e.date), now)
    ).length;

    return { activeSchools, activeContacts, recentActivities, upcomingEvents };
  }, [state]);

  const countyData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const school of state.schools) {
      counts[school.county] = (counts[school.county] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [state.schools]);

  const activityBySchool = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const activity of state.activities) {
      const school = getSchoolById(activity.schoolId);
      if (school) {
        const name = school.name.length > 25 ? school.name.slice(0, 22) + '...' : school.name;
        counts[name] = (counts[name] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([name, activities]) => ({ name, activities }))
      .sort((a, b) => b.activities - a.activities)
      .slice(0, 8);
  }, [state.activities, getSchoolById]);

  const upcomingEvents = useMemo(
    () =>
      state.events
        .filter((e) => isAfter(new Date(e.date), new Date()))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(0, 5),
    [state.events]
  );

  const recentActivities = useMemo(
    () =>
      [...state.activities]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 5),
    [state.activities]
  );

  return (
    <div>
      <Header
        title="Dashboard"
        subtitle="Overview of your engagement activities"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => navigate('/import')}>
              <Upload size={16} />
              Import
            </Button>
            <Button size="sm" onClick={() => navigate('/contacts')}>
              <Plus size={16} />
              Add Contact
            </Button>
          </div>
        }
      />
      <div className="p-8 space-y-8">
        {/* Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard
            title="Active Schools"
            value={metrics.activeSchools}
            subtitle={`${state.schools.length} total`}
            icon={<School size={24} />}
          />
          <MetricCard
            title="Active Contacts"
            value={metrics.activeContacts}
            subtitle={`${state.contacts.length} total`}
            icon={<Users size={24} />}
          />
          <MetricCard
            title="Upcoming Events"
            value={metrics.upcomingEvents}
            subtitle={`${state.events.length} total`}
            icon={<Calendar size={24} />}
          />
          <MetricCard
            title="Activities (12 mo)"
            value={metrics.recentActivities}
            subtitle={`${state.activities.length} all time`}
            icon={<TrendingUp size={24} />}
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Activity by School */}
          <Card className="lg:col-span-2">
            <h3 className="text-sm font-semibold text-neutral-700 mb-4">Activity by School</h3>
            {activityBySchool.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={activityBySchool} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8E9EA" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={150} />
                  <Tooltip />
                  <Bar dataKey="activities" fill="#CE1126" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-neutral-400 text-sm py-12 text-center">No activity data yet.</p>
            )}
          </Card>

          {/* County Distribution */}
          <Card>
            <h3 className="text-sm font-semibold text-neutral-700 mb-4">Schools by County</h3>
            {countyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={countyData}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    dataKey="value"
                    label={({ name, value }) => `${name} (${value})`}
                    labelLine={false}
                  >
                    {countyData.map((_, i) => (
                      <Cell key={i} fill={COUNTY_COLORS[i % COUNTY_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-neutral-400 text-sm py-12 text-center">No schools added yet.</p>
            )}
          </Card>
        </div>

        {/* Upcoming Events & Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-neutral-700">Upcoming Events</h3>
              <button
                onClick={() => navigate('/events')}
                className="text-sm text-siue-red hover:text-siue-maroon font-medium flex items-center gap-1"
              >
                View all <ArrowRight size={14} />
              </button>
            </div>
            {upcomingEvents.length > 0 ? (
              <div className="space-y-3">
                {upcomingEvents.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between py-2 border-b border-neutral-50 last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-neutral-700">{event.name}</p>
                      <p className="text-xs text-neutral-400">{event.location}</p>
                    </div>
                    <Badge variant="info">{format(new Date(event.date), 'MMM d, yyyy')}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-neutral-400 text-sm py-8 text-center">No upcoming events.</p>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-neutral-700">Recent Activity</h3>
              <button
                onClick={() => navigate('/analytics')}
                className="text-sm text-siue-red hover:text-siue-maroon font-medium flex items-center gap-1"
              >
                View analytics <ArrowRight size={14} />
              </button>
            </div>
            {recentActivities.length > 0 ? (
              <div className="space-y-3">
                {recentActivities.map((activity) => {
                  const school = getSchoolById(activity.schoolId);
                  return (
                    <div
                      key={activity.id}
                      className="flex items-start justify-between py-2 border-b border-neutral-50 last:border-0"
                    >
                      <div>
                        <p className="text-sm font-medium text-neutral-700">
                          {activity.description}
                        </p>
                        <p className="text-xs text-neutral-400">{school?.name}</p>
                      </div>
                      <span className="text-xs text-neutral-400 whitespace-nowrap">
                        {format(new Date(activity.date), 'MMM d')}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-neutral-400 text-sm py-8 text-center">No activities recorded yet.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
