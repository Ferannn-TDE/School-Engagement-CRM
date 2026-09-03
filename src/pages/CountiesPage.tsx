import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  MapPin, ArrowRight, School, Users, Calendar, BookOpen,
  BarChart3, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { EmptyState } from '../components/common/EmptyState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ChartTooltipContent } from '../components/common/ChartTooltip';
import { CHART_COLORS } from '../constants/charts';
import { useCountyAnalytics } from '../hooks/useCountyAnalytics';
import { ProgramCategory, ProgramCategoryLabels } from '../types';
import {
  fetchCountySchoolSummary,
  fetchCountyEngagementRate,
  type CountySchoolSummaryRow,
  type CountyEngagementRow,
} from '../services/analyticsService';

/** Collapsible wrapper for the county-level charts below the directory. */
function AnalysisSection({
  icon,
  title,
  description,
  badge,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card padding={false}>
      <button
        className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left hover:bg-neutral-50 rounded-xl transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-0.5 shrink-0 text-neutral-400">{icon}</span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-neutral-800">{title}</h2>
            <p className="text-sm text-neutral-500 mt-0.5">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Badge variant="default">{badge}</Badge>
          {open ? (
            <ChevronUp size={18} className="text-neutral-400" />
          ) : (
            <ChevronDown size={18} className="text-neutral-400" />
          )}
        </div>
      </button>
      {open && <div className="border-t border-neutral-100 px-6 py-5">{children}</div>}
    </Card>
  );
}

interface CountyCardData {
  countyName: string;
  totalSchools: number;
  verifiedSchools: number;
  totalContacts: number;
  totalEvents: number;
  totalPrograms: number;
  engagedSchools: number;
  engagementPct: number;
}

function engagementBadgeVariant(pct: number): 'success' | 'warning' | 'error' {
  if (pct >= 30) return 'success';
  if (pct >= 10) return 'warning';
  return 'error';
}

export function CountiesPage() {
  const [summaryData, setSummaryData] = useState<CountySchoolSummaryRow[]>([]);
  const [engagementData, setEngagementData] = useState<CountyEngagementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchCountySchoolSummary(), fetchCountyEngagementRate()])
      .then(([summary, engagement]) => {
        setSummaryData(summary);
        setEngagementData(engagement);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load county data');
      })
      .finally(() => setLoading(false));
  }, []);

  const counties = useMemo((): CountyCardData[] => {
    const engagementMap = new Map<string, CountyEngagementRow>();
    for (const row of engagementData) {
      // Skip rows with no county name — they can't be keyed or displayed
      if (!row.county_name) continue;
      engagementMap.set(row.county_name, row);
    }
    return summaryData
      // Exclude schools with null/empty county — they have no place in the counties view
      .filter((s): s is typeof s & { county_name: string } => Boolean(s.county_name))
      .map((s) => {
        const e = engagementMap.get(s.county_name);
        return {
          countyName: s.county_name,
          totalSchools: s.total_schools,
          verifiedSchools: s.verified_schools,
          totalContacts: s.total_contacts,
          totalEvents: s.total_events,
          totalPrograms: s.total_programs,
          engagedSchools: e?.engaged_schools ?? 0,
          engagementPct: e?.engagement_pct ?? 0,
        };
      })
      .sort((a, b) => (a.countyName ?? '').localeCompare(b.countyName ?? ''));
  }, [summaryData, engagementData]);

  const { engagementRateByCounty, countyComparisonData, programCoverageByCounty } =
    useCountyAnalytics(engagementData);

  return (
    <div>
<Header
        title="Counties"
        subtitle={loading ? 'Loading...' : `${counties.length} counties in Illinois`}
      />
      <div className="p-8">
        {loading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner />
          </div>
        ) : error ? (
          <EmptyState
            icon={<MapPin size={32} />}
            title="Could not load county data"
            description={error}
          />
        ) : counties.length === 0 ? (
          <EmptyState
            icon={<MapPin size={32} />}
            title="No county data available"
            description="County summaries are computed from the schools database. Add schools to see county breakdowns."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {counties.map((county) => (
              <Card key={county.countyName} padding={false}>
                <div className="p-5">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-siue-red/10">
                        <MapPin size={16} className="text-siue-red" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-neutral-800 leading-tight">
                          {county.countyName}
                        </h3>
                        <p className="text-xs text-neutral-400">County</p>
                      </div>
                    </div>
                    <Badge variant={engagementBadgeVariant(county.engagementPct)}>
                      {county.engagementPct}% engaged
                    </Badge>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    {[
                      { icon: School, label: 'Schools', value: county.totalSchools },
                      { icon: Users, label: 'Contacts', value: county.totalContacts },
                      { icon: Calendar, label: 'Events', value: county.totalEvents },
                      { icon: BookOpen, label: 'Programs', value: county.totalPrograms },
                    ].map(({ icon: Icon, label, value }) => (
                      <div key={label} className="text-center">
                        <Icon size={14} className="mx-auto text-neutral-400 mb-0.5" />
                        <p className="text-base font-bold text-neutral-800">{value}</p>
                        <p className="text-xs text-neutral-400">{label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Engagement progress bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-neutral-500">
                        {county.engagedSchools} / {county.totalSchools} schools at events
                      </p>
                    </div>
                    <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-siue-red rounded-full"
                        style={{ width: `${Math.min(county.engagementPct, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Verified split */}
                  <div className="flex items-center gap-3 mb-4 text-xs text-neutral-500">
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
                      {county.verifiedSchools} verified
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />
                      {county.totalSchools - county.verifiedSchools} unverified
                    </span>
                  </div>
                </div>

                {/* Footer link */}
                <div className="px-5 py-3 border-t border-neutral-100">
                  <Link
                    to={`/counties/${encodeURIComponent(county.countyName)}`}
                    className="flex items-center justify-between text-xs font-medium text-siue-red hover:text-siue-maroon transition-colors"
                  >
                    View Details
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* ── County-level analysis, moved here from the old Analytics page ──── */}
        {!loading && !error && counties.length > 0 && (
          <div className="mt-8 space-y-5">
            <h2 className="text-lg font-semibold text-neutral-800">Compare counties</h2>

            <AnalysisSection
              icon={<BarChart3 size={18} />}
              title="Engagement rate"
              description="Share of each county's schools that have appeared at an event. Lowest first."
              badge={`${engagementRateByCounty.length} counties`}
              defaultOpen
            >
              {engagementRateByCounty.length > 0 ? (
                <div className="space-y-2.5">
                  {engagementRateByCounty.map((c) => (
                    <div key={c.county} className="flex items-center gap-3">
                      <span className="w-28 text-sm text-neutral-700 truncate shrink-0">
                        {c.county}
                      </span>
                      <div className="flex-1 h-2 bg-neutral-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-siue-red rounded-full"
                          style={{ width: `${Math.round(c.rate * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-neutral-500 w-40 text-right shrink-0">
                        {c.engaged}/{c.total} {c.label} ={' '}
                        <span className="font-medium text-neutral-700">
                          {Math.round(c.rate * 100)}%
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-neutral-500 text-sm py-8 text-center">No school data yet.</p>
              )}
            </AnalysisSection>

            <AnalysisSection
              icon={<School size={18} />}
              title="Schools reached"
              description="Total schools against schools that have appeared at an event, per county."
              badge={`${countyComparisonData.length} counties`}
            >
              {countyComparisonData.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={countyComparisonData} margin={{ top: 4, right: 24, left: 0, bottom: 64 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8E9EA" vertical={false} />
                    <XAxis dataKey="county" tick={{ fontSize: 11, fill: '#8A8D8F' }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#8A8D8F' }} />
                    <Tooltip content={<ChartTooltipContent />} />
                    <Legend wrapperStyle={{ fontSize: '12px', color: '#54585A' }} />
                    <Bar dataKey="total" fill="#54585A" radius={[4, 4, 0, 0]} name="Total Schools" />
                    <Bar dataKey="engaged" fill="#CE1126" radius={[4, 4, 0, 0]} name="Reached" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-neutral-500 text-sm py-8 text-center">No school data yet.</p>
              )}
            </AnalysisSection>

            <AnalysisSection
              icon={<BookOpen size={18} />}
              title="Programs by category"
              description="Which kinds of programs run in each county — top 10 counties by total."
              badge={`${programCoverageByCounty.length} counties`}
            >
              {programCoverageByCounty.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={programCoverageByCounty} margin={{ top: 4, right: 24, left: 0, bottom: 64 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8E9EA" vertical={false} />
                    <XAxis dataKey="county" tick={{ fontSize: 11, fill: '#8A8D8F' }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#8A8D8F' }} />
                    <Tooltip content={<ChartTooltipContent />} />
                    <Legend wrapperStyle={{ fontSize: '12px', color: '#54585A' }} />
                    {Object.values(ProgramCategory).map((cat, i) => (
                      <Bar
                        key={cat}
                        dataKey={cat}
                        stackId="a"
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                        name={ProgramCategoryLabels[cat]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="py-8 text-center">
                  <BookOpen size={28} className="mx-auto mb-3 text-neutral-300" />
                  <p className="text-sm font-medium text-neutral-600">No programs recorded yet</p>
                  <p className="text-sm text-neutral-500 mt-1">
                    Add programs from a school&rsquo;s detail page.
                  </p>
                </div>
              )}
            </AnalysisSection>
          </div>
        )}
      </div>
    </div>
  );
}
