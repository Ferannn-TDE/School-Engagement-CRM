import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, ArrowRight, School, Users, Calendar, BookOpen } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { EmptyState } from '../components/common/EmptyState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import {
  fetchCountySchoolSummary,
  fetchCountyEngagementRate,
  type CountySchoolSummaryRow,
  type CountyEngagementRow,
} from '../services/analyticsService';

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
      </div>
    </div>
  );
}
