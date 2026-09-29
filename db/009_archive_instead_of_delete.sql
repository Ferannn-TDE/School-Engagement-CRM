-- 009 — Archive instead of delete
--
-- Why: the no-loss rule covers the app too. Every delete in the app (10 calls, in
-- schoolsService, contactsService, eventsService, programsService and
-- activitiesService) removed rows for good. From now on the app archives instead:
-- the row stays, disappears from normal views, and can be restored from
-- Settings → Archived.
--
-- What changes:
--   * archived (boolean, default false), archived_at and archived_by on schools, staff,
--     contacts (the school↔staff links), events, programs and activities. Every
--     existing row starts not archived, so nothing disappears and no value changes.
--   * A trigger stamps archived_at (now) and archived_by (the signed-in user's email)
--     when a row is archived without them, and clears both when it is restored.
--   * archive_school / restore_school: a school, its staff and their links are archived
--     together with ONE shared timestamp, and restore brings back exactly that set
--     (a contact archived on its own earlier stays archived).
--   * archive_contact / restore_contact: a staff member and their school links, the
--     same way.
--   * The two county views leave archived schools, links, events and programs out.
--     Nothing is archived yet, so their numbers don't change today.
--
-- The functions run as the calling user (security invoker), so RLS and the aal2 rule
-- (db/003) still apply. EXECUTE is granted to signed-in users only, not anon.
--
-- archived, archived_at and archived_by are not protected by the db/006 edit locks,
-- so archiving never locks a field, and the scraper leaves them alone (its SQL never
-- names them): an archived row the scraper updates stays archived.
--
-- Snapshot before applying (all six tables, outside the repo):
--   ~/Desktop/CRM-db-exports/2026-09-29-phase5-step7-before/
-- UNDO (only once no row is archived, or after restoring them all; the columns can
-- stay, since they hold history):
--   drop function public.archive_school(text), public.restore_school(text),
--                 public.archive_contact(integer), public.restore_contact(integer);
--   drop trigger stamp_archive on each of the six tables; drop function public.stamp_archive();
--   re-run db/008 for the county views.

begin;

alter table public.schools
  add column if not exists archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text;
alter table public.staff
  add column if not exists archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text;
alter table public.contacts
  add column if not exists archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text;
alter table public.events
  add column if not exists archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text;
alter table public.programs
  add column if not exists archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text;
alter table public.activities
  add column if not exists archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text;

-- Who archived a row and when. Runs only when an update names the archived column.
create or replace function public.stamp_archive()
returns trigger
language plpgsql
as $fn$
begin
  if new.archived and not old.archived then
    new.archived_at := coalesce(new.archived_at, now());
    new.archived_by := coalesce(
      new.archived_by,
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
      'database'
    );
  elsif old.archived and not new.archived then
    new.archived_at := null;
    new.archived_by := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists stamp_archive on public.schools;
create trigger stamp_archive before update of archived on public.schools
  for each row execute function public.stamp_archive();
drop trigger if exists stamp_archive on public.staff;
create trigger stamp_archive before update of archived on public.staff
  for each row execute function public.stamp_archive();
drop trigger if exists stamp_archive on public.contacts;
create trigger stamp_archive before update of archived on public.contacts
  for each row execute function public.stamp_archive();
drop trigger if exists stamp_archive on public.events;
create trigger stamp_archive before update of archived on public.events
  for each row execute function public.stamp_archive();
drop trigger if exists stamp_archive on public.programs;
create trigger stamp_archive before update of archived on public.programs
  for each row execute function public.stamp_archive();
drop trigger if exists stamp_archive on public.activities;
create trigger stamp_archive before update of archived on public.activities
  for each row execute function public.stamp_archive();

-- A school with its staff and their links, all with one timestamp.
create or replace function public.archive_school(p_facility_key text)
returns void
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  ts timestamptz := now();
  who text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'database');
begin
  update schools set archived = true, archived_at = ts, archived_by = who
   where facility_key = p_facility_key and not archived;
  if not found then
    raise exception 'School % was not found or is already archived', p_facility_key;
  end if;
  update contacts set archived = true, archived_at = ts, archived_by = who
   where not archived
     and (school_id = p_facility_key
          or staff_id in (select staff_id from staff where school_worked_at = p_facility_key));
  update staff set archived = true, archived_at = ts, archived_by = who
   where school_worked_at = p_facility_key and not archived;
end;
$fn$;

-- Brings back exactly what archive_school archived: rows with the school's timestamp.
create or replace function public.restore_school(p_facility_key text)
returns void
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  ts timestamptz;
begin
  select archived_at into ts from schools where facility_key = p_facility_key and archived;
  if not found then
    raise exception 'School % was not found or is not archived', p_facility_key;
  end if;
  update contacts set archived = false
   where archived and archived_at is not distinct from ts
     and (school_id = p_facility_key
          or staff_id in (select staff_id from staff where school_worked_at = p_facility_key));
  update staff set archived = false
   where archived and archived_at is not distinct from ts and school_worked_at = p_facility_key;
  update schools set archived = false where facility_key = p_facility_key;
end;
$fn$;

-- A staff member with their school links, one timestamp.
create or replace function public.archive_contact(p_staff_id integer)
returns void
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  ts timestamptz := now();
  who text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'database');
begin
  update staff set archived = true, archived_at = ts, archived_by = who
   where staff_id = p_staff_id and not archived;
  if not found then
    raise exception 'Contact % was not found or is already archived', p_staff_id;
  end if;
  update contacts set archived = true, archived_at = ts, archived_by = who
   where staff_id = p_staff_id and not archived;
end;
$fn$;

create or replace function public.restore_contact(p_staff_id integer)
returns void
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  ts timestamptz;
begin
  select archived_at into ts from staff where staff_id = p_staff_id and archived;
  if not found then
    raise exception 'Contact % was not found or is not archived', p_staff_id;
  end if;
  update contacts set archived = false
   where staff_id = p_staff_id and archived and archived_at is not distinct from ts;
  update staff set archived = false where staff_id = p_staff_id;
end;
$fn$;

revoke all on function public.archive_school(text), public.restore_school(text),
  public.archive_contact(integer), public.restore_contact(integer) from public, anon;
grant execute on function public.archive_school(text), public.restore_school(text),
  public.archive_contact(integer), public.restore_contact(integer) to authenticated, service_role;

-- County views (as db/008) without archived rows.
create or replace view public.county_engagement_rate
  with (security_invoker = on) as
select county_name,
       total_schools,
       engaged_schools,
       case
         when total_schools > 0
           then round(engaged_schools::numeric / total_schools::numeric * 100::numeric, 1)
         else 0::numeric
       end as engagement_pct,
       state_code
  from (select s.county_name,
               s.state_code,
               count(*) as total_schools,
               count(*) filter (where exists (
                 select 1 from events e
                  where e.schools_involved ~~ (('%'::text || s.facility_key) || '%'::text)
                    and e.category is distinct from 'school_testing_date'
                    and not e.archived
               )) as engaged_schools
          from schools s
         where not s.archived
         group by s.county_name, s.state_code) sub
 order by (case
             when total_schools > 0
               then round(engaged_schools::numeric / total_schools::numeric * 100::numeric, 1)
             else 0::numeric
           end);

create or replace view public.county_school_summary
  with (security_invoker = on) as
select s.county_name,
       count(distinct s.facility_key) as total_schools,
       count(distinct s.facility_key) filter (where s.is_verified = true) as verified_schools,
       count(distinct c.staff_id) as total_contacts,
       count(distinct e.event_id) as total_events,
       count(distinct p.program_id) as total_programs,
       s.state_code
  from schools s
  left join contacts c on c.school_id = s.facility_key and not c.archived
  left join events e on e.schools_involved ~~ (('%'::text || s.facility_key) || '%'::text)
                    and e.category is distinct from 'school_testing_date'
                    and not e.archived
  left join programs p on p.school_id = s.facility_key and p.is_active = true and not p.archived
 where not s.archived
 group by s.county_name, s.state_code
 order by s.county_name, s.state_code;

commit;
