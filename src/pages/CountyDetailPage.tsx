import { useState, useEffect, useMemo } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { MapPin, School, Users, Calendar, BookOpen, ChevronUp, ChevronDown, ChevronsUpDown, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { Header } from '../components/layout/Header';
import { Breadcrumb } from '../components/common/Breadcrumb';
import { Card, MetricCard } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { EmptyState } from '../components/common/EmptyState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useAppContext } from '../context/AppContext';
import { EventTypeLabels, ProgramCategory, ProgramCategoryLabels } from '../types';
import type { EventType } from '../types';
import { computeEngagementScore } from '../utils/engagementScore';
import {
  fetchCountySchoolSummary,
  fetchCountyEngagementRate,
  type CountySchoolSummaryRow,
} from '../services/analyticsService';
import { formatSchoolType } from '../utils/helpers';
import { countyLabel, countyPath, mergeCountyRows, sameCounty } from '../utils/counties';

type SortField = 'name' | 'contacts' | 'score';
type SortDir = 'asc' | 'desc';

function SortIcon({ field, current, dir }: { field: SortField; current: SortField; dir: SortDir }) {
  if (field !== current) return <ChevronsUpDown size={13} className="text-neutral-300" />;
  return dir === 'asc'
    ? <ChevronUp size={13} className="text-siue-red" />
    : <ChevronDown size={13} className="text-siue-red" />;
}

export function CountyDetailPage() {
  const { state: rawState, countyName: rawCounty } = useParams<{ state?: string; countyName: string }>();
  const countyName = rawCounty ? decodeURIComponent(rawCounty) : '';
  // Absent only on older /counties/:name links, which are resolved below.
  const countyState = rawState ? decodeURIComponent(rawState) : undefined;
  const title = countyLabel(countyName, countyState);

  const { state, loading } = useAppContext();
  const [summaryRow, setSummaryRow] = useState<CountySchoolSummaryRow | null>(null);
  const [engagementPct, setEngagementPct] = useState<number>(0);
  const [loadingViews, setLoadingViews] = useState(true);
  const [sortField, setSortField] = useState<SortField>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    setLoadingViews(true);
    Promise.all([fetchCountySchoolSummary(), fetchCountyEngagementRate()])
      .then(([summary, engagement]) => {
        const isThis = (r: { county_name: string | null; state_code: string | null }) =>
          !!r.county_name && sameCounty(r.county_name, countyName) && (!countyState || r.state_code === countyState);
        setSummaryRow(mergeCountyRows(summary.filter(isThis))[0] ?? null);
        setEngagementPct(mergeCountyRows(engagement.filter(isThis))[0]?.engagement_pct ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoadingViews(false));
  }, [countyName, countyState]);

  // ── Per-county derived data ──────────────────────────────────────────────────
  const countySchools = useMemo(
    () =>
      state.schools.filter(
        (s) => sameCounty(s.county, countyName) && (!countyState || s.state === countyState)
      ),
    [state.schools, countyName, countyState]
  );

  const countySchoolIds = useMemo(
    () => new Set(countySchools.map((s) => s.id)),
    [countySchools]
  );

  // Build lookup maps for engagement score computation
  const contactsBySchool = useMemo(() => {
    const map = new Map<string, typeof state.contacts>();
    for (const c of state.contacts) {
      const list = map.get(c.schoolId) ?? [];
      list.push(c);
      map.set(c.schoolId, list);
    }
    return map;
  }, [state.contacts]);

  const activitiesBySchool = useMemo(() => {
    const map = new Map<string, typeof state.activities>();
    for (const a of state.activities) {
      const list = map.get(a.schoolId) ?? [];
      list.push(a);
      map.set(a.schoolId, list);
    }
    return map;
  }, [state.activities]);

  const eventsBySchool = useMemo(() => {
    const map = new Map<string, typeof state.events>();
    for (const e of state.events) {
      for (const sid of e.participatingSchools) {
        const list = map.get(sid) ?? [];
        list.push(e);
        map.set(sid, list);
      }
    }
    return map;
  }, [state.events]);

  const programsBySchool = useMemo(() => {
    const map = new Map<string, typeof state.programs>();
    for (const p of state.programs) {
      const list = map.get(p.schoolId) ?? [];
      list.push(p);
      map.set(p.schoolId, list);
    }
    return map;
  }, [state.programs]);

  // Scored school rows
  const scoredSchools = useMemo(() => {
    return countySchools.map((school) => {
      const contacts = contactsBySchool.get(school.id) ?? [];
      const activities = activitiesBySchool.get(school.id) ?? [];
      const events = eventsBySchool.get(school.id) ?? [];
      const programs = programsBySchool.get(school.id) ?? [];
      const result = computeEngagementScore(contacts, activities, events, programs);
      return {
        school,
        contacts: contacts.filter((c) => c.isActive).length,
        score: result.score,
        tier: result.tier,
      };
    });
  }, [countySchools, contactsBySchool, activitiesBySchool, eventsBySchool, programsBySchool]);

  const sortedSchools = useMemo(() => {
    return [...scoredSchools].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.school.name.localeCompare(b.school.name);
      else if (sortField === 'contacts') cmp = a.contacts - b.contacts;
      else cmp = a.score - b.score;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [scoredSchools, sortField, sortDir]);

  // County events: any event where at least one participating school is in this county
  const countyEvents = useMemo(
    () =>
      state.events
        .filter((e) => e.participatingSchools.some((sid) => countySchoolIds.has(sid)))
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [state.events, countySchoolIds]
  );

  // Program coverage: count per category across all county schools
  const programCoverage = useMemo(() => {
    const counts: Partial<Record<ProgramCategory, number>> = {};
    for (const p of state.programs) {
      if (countySchoolIds.has(p.schoolId) && p.isActive) {
        counts[p.category] = (counts[p.category] ?? 0) + 1;
      }
    }
    return Object.values(ProgramCategory)
      .map((cat) => ({ category: cat, label: ProgramCategoryLabels[cat], count: counts[cat] ?? 0 }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [state.programs, countySchoolIds]);

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  if (loading) return <LoadingSpinner />;

  // An older link with no state: go straight to the county if only one state has
  // it, or ask which one when both do (40 names exist in Illinois and Missouri).
  if (!countyState) {
    const states = [...new Set(countySchools.map((s) => s.state).filter(Boolean))].sort();
    if (states.length === 1) return <Navigate to={countyPath(countyName, states[0])} replace />;
    if (states.length > 1) {
      return (
        <EmptyState
          icon={<MapPin size={32} />}
          title={`There is a ${countyName} County in more than one state`}
          description="Choose which one you meant."
          action={
            <div className="flex flex-col gap-2">
              {states.map((st) => (
                <Link
                  key={st}
                  to={countyPath(countyName, st)}
                  className="text-sm font-medium text-siue-red hover:text-siue-maroon"
                >
                  {countyLabel(countyName, st)}
                </Link>
              ))}
            </div>
          }
        />
      );
    }
  }

  if (countySchools.length === 0 && !loadingViews) {
    return (
      <EmptyState
        icon={<MapPin size={32} />}
        title={`No schools found in ${title}`}
        description="This county may not exist in the database, or schools haven't been added yet."
        action={
          <Link
            to="/counties"
            className="inline-flex items-center gap-2 text-sm font-medium text-siue-red hover:text-siue-maroon"
          >
            <ArrowLeft size={14} />
            Back to Counties
          </Link>
        }
      />
    );
  }

  const tierVariant = (tier: 'high' | 'medium' | 'low'): 'success' | 'warning' | 'error' =>
    tier === 'high' ? 'success' : tier === 'medium' ? 'warning' : 'error';

  return (
    <div>
      <Breadcrumb
        crumbs={[
          { label: 'Counties', href: '/counties' },
          { label: title },
        ]}
      />
      <Header
        title={title}
        subtitle={`${countySchools.length} schools · ${engagementPct}% engagement rate`}
      />

      <div className="p-8 space-y-6">
        {/* ── Section 1: Summary metrics ───────────────────────────────────────── */}
        {loadingViews ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <MetricCard
              title="Total Schools"
              value={summaryRow?.total_schools ?? countySchools.length}
              subtitle="in this county"
              icon={<School size={20} />}
            />
            <MetricCard
              title="Verified Schools"
              value={summaryRow?.verified_schools ?? countySchools.filter((s) => s.isVerified).length}
              subtitle={`of ${summaryRow?.total_schools ?? countySchools.length} total`}
              icon={<School size={20} />}
            />
            <MetricCard
              title="Contacts"
              value={summaryRow?.total_contacts ?? 0}
              subtitle="staff records"
              icon={<Users size={20} />}
            />
            <MetricCard
              title="Events"
              value={summaryRow?.total_events ?? countyEvents.length}
              subtitle="appearances"
              icon={<Calendar size={20} />}
            />
            <MetricCard
              title="Programs"
              value={summaryRow?.total_programs ?? state.programs.filter((p) => countySchoolIds.has(p.schoolId)).length}
              subtitle="active offerings"
              icon={<BookOpen size={20} />}
            />
          </div>
        )}

        {/* ── Section 2: Schools table ─────────────────────────────────────────── */}
        <Card padding={false}>
          <div className="px-5 py-4 border-b border-neutral-100 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-siue-red/10">
              <School size={18} className="text-siue-red" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-neutral-800">Schools</h2>
              <p className="text-xs text-neutral-500">{countySchools.length} schools in {title}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-100 table-fixed">
              <colgroup>
                <col style={{ width: '38%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '17%' }} />
              </colgroup>
              <thead className="bg-neutral-50">
                <tr>
                  <th
                    className="px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wider cursor-pointer select-none hover:text-neutral-700"
                    onClick={() => handleSort('name')}
                  >
                    <span className="flex items-center gap-1">
                      School
                      <SortIcon field="name" current={sortField} dir={sortDir} />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th
                    className="px-4 py-3 text-center text-xs font-semibold text-neutral-500 uppercase tracking-wider cursor-pointer select-none hover:text-neutral-700"
                    onClick={() => handleSort('contacts')}
                  >
                    <span className="flex items-center justify-center gap-1">
                      Contacts
                      <SortIcon field="contacts" current={sortField} dir={sortDir} />
                    </span>
                  </th>
                  <th
                    className="px-4 py-3 text-center text-xs font-semibold text-neutral-500 uppercase tracking-wider cursor-pointer select-none hover:text-neutral-700"
                    onClick={() => handleSort('score')}
                  >
                    <span className="flex items-center justify-center gap-1">
                      Score
                      <SortIcon field="score" current={sortField} dir={sortDir} />
                    </span>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                    Tier
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-neutral-50">
                {sortedSchools.map(({ school, contacts, score, tier }) => (
                  <tr key={school.id} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3 text-sm">
                      <Link
                        to={`/schools/${encodeURIComponent(school.id)}`}
                        className="font-medium text-neutral-800 hover:text-siue-red transition-colors"
                      >
                        {school.name}
                      </Link>
                      {school.district && (
                        <p className="text-xs text-neutral-500 mt-0.5">{school.district}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="default">{formatSchoolType(school.schoolType)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-700 text-center">{contacts}</td>
                    <td className="px-4 py-3 text-sm font-medium text-neutral-800 text-center">{score}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={tierVariant(tier)}>
                        {tier.charAt(0).toUpperCase() + tier.slice(1)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* ── Section 3: Events ────────────────────────────────────────────────── */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-siue-red/10">
              <Calendar size={18} className="text-siue-red" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-neutral-800">Events</h2>
              <p className="text-xs text-neutral-500">
                Events where a {title} school participated
              </p>
            </div>
          </div>
          {countyEvents.length > 0 ? (
            <div className="divide-y divide-neutral-50">
              {countyEvents.slice(0, 20).map((event) => {
                const schoolsInCounty = event.participatingSchools.filter((sid) =>
                  countySchoolIds.has(sid)
                ).length;
                return (
                  <div key={event.id} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium text-neutral-700">{event.name}</p>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {format(new Date(event.date), 'MMM d, yyyy')}
                        {' · '}
                        {schoolsInCounty} school{schoolsInCounty !== 1 ? 's' : ''} from this county
                      </p>
                    </div>
                    <Badge variant="info">{EventTypeLabels[event.type as EventType]}</Badge>
                  </div>
                );
              })}
              {countyEvents.length > 20 && (
                <p className="text-xs text-neutral-500 pt-3 text-center">
                  Showing 20 of {countyEvents.length} events
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-neutral-500 py-4 text-center">
              No events recorded for schools in this county yet.
            </p>
          )}
        </Card>

        {/* ── Section 4: Program coverage ──────────────────────────────────────── */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-siue-red/10">
              <BookOpen size={18} className="text-siue-red" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-neutral-800">Program Coverage</h2>
              <p className="text-xs text-neutral-500">
                Active programs recorded across schools in {title}
              </p>
            </div>
          </div>
          {programCoverage.length > 0 ? (
            <div className="space-y-3">
              {programCoverage.map(({ label, count }) => {
                const pct = countySchools.length > 0 ? (count / countySchools.length) * 100 : 0;
                return (
                  <div key={label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-neutral-700">{label}</span>
                      <span className="text-xs font-medium text-neutral-500">
                        {count} school{count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-siue-red rounded-full"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-neutral-500 py-4 text-center">
              No programs recorded for schools in this county. Add programs from each school's detail page.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
