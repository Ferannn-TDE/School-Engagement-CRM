-- 006 — A client's edit is never overwritten by the scraper
--
-- Why: the scraper updates schools and staff rows in place. A phone number, title or
-- note the client corrects in the app would be replaced by the next scraper run,
-- silently undoing their work.
--
-- How it works (enforced in the database, so it holds even if the scraper's SQL
-- changes later):
--   * manual_fields  — the columns a person has edited on that row.
--   * pending_scraped — what the scraper tried to write over a locked column, and
--                       when, so nothing it found is thrown away. A later screen can
--                       show "the school's website now says X" and let the client
--                       accept or ignore it.
--   * A trigger runs before every update:
--       - An update from the app (it carries sign-in claims, the same test db/002
--         uses) adds each protected column it changes to manual_fields.
--       - An update from the scraper (a direct database connection with no claims)
--         keeps the stored value of every column in manual_fields, and records the
--         scraper's value in pending_scraped instead. Unlocked columns update as usual.
--
-- Notes:
--   * Edits made by hand in the Supabase SQL Editor also carry no claims, so they are
--     treated like the scraper and cannot change a locked column. Change a locked
--     column through the app, or remove it from manual_fields first.
--   * Imports run through the app, so columns an import fills in count as edited.
--   * Only the columns listed in each trigger are protected. Bookkeeping columns
--     (updated_at, is_verified, ...) are not.
--   * Existing rows start with nothing locked: no stored value changes.
--
-- Reversible: drop the two triggers and the function; the two columns can stay (they
-- hold history) or be dropped once their contents are exported.

begin;

alter table public.schools
  add column if not exists manual_fields text[] not null default '{}',
  add column if not exists pending_scraped jsonb not null default '{}';

alter table public.staff
  add column if not exists manual_fields text[] not null default '{}',
  add column if not exists pending_scraped jsonb not null default '{}';

create or replace function public.protect_manual_edits()
returns trigger
language plpgsql
as $fn$
declare
  from_app boolean := coalesce(current_setting('request.jwt.claims', true), '') <> '';
  protected text[] := tg_argv::text[];
  new_row jsonb := to_jsonb(new);
  old_row jsonb := to_jsonb(old);
  pending jsonb := old.pending_scraped;
  col text;
begin
  if from_app then
    -- A person changed these: lock them. manual_fields is taken from the update, so
    -- the app can also unlock a column deliberately by removing it.
    foreach col in array protected loop
      if new_row -> col is distinct from old_row -> col
         and not (col = any (new.manual_fields)) then
        new.manual_fields := array_append(new.manual_fields, col);
      end if;
    end loop;
    return new;
  end if;

  -- The scraper (or any connection without sign-in claims): keep every locked column
  -- as the person left it, and park what the scraper wanted to write.
  foreach col in array old.manual_fields loop
    if new_row -> col is distinct from old_row -> col then
      pending := pending || jsonb_build_object(
        col, jsonb_build_object('value', new_row -> col, 'seen_at', now())
      );
      new_row := jsonb_set(new_row, array[col], old_row -> col);
    end if;
  end loop;
  new := jsonb_populate_record(new, new_row);
  new.manual_fields := old.manual_fields;
  new.pending_scraped := pending;
  return new;
end;
$fn$;

drop trigger if exists protect_manual_edits on public.schools;
create trigger protect_manual_edits
  before update on public.schools
  for each row
  execute function public.protect_manual_edits(
    'name', 'phone', 'address', 'type_of_school', 'admin', 'city', 'zipcode',
    'grades_served', 'website', 'county_name', 'is_active', 'notes', 'enrollment',
    'grade_range', 'priority_tier', 'state_code'
  );

drop trigger if exists protect_manual_edits on public.staff;
create trigger protect_manual_edits
  before update on public.staff
  for each row
  execute function public.protect_manual_edits(
    'name', 'phone', 'email', 'job_name', 'school_worked_at', 'is_active', 'notes'
  );

commit;
