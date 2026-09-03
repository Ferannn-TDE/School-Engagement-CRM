import { supabase } from './supabase';

export interface CountyEngagementRow {
  county_name: string | null;
  total_schools: number;
  engaged_schools: number;
  engagement_pct: number;
}

export interface CountySchoolSummaryRow {
  county_name: string | null;
  total_schools: number;
  verified_schools: number;
  total_contacts: number;
  total_events: number;
  total_programs: number;
}

export async function fetchCountyEngagementRate(): Promise<CountyEngagementRow[]> {
  const { data, error } = await supabase
    .from('county_engagement_rate')
    .select('*')
    .order('total_schools', { ascending: false });
  if (error) throw error;
  return data as CountyEngagementRow[];
}

export async function fetchCountySchoolSummary(): Promise<CountySchoolSummaryRow[]> {
  const { data, error } = await supabase
    .from('county_school_summary')
    .select('*')
    .order('county_name', { ascending: true });
  if (error) throw error;
  return data as CountySchoolSummaryRow[];
}
