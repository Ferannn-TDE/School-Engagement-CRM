-- 013 — Link overrides: the client's own website and staff-page links for a school
--
-- Why: plan item C9. The scraper finds each school's website itself (schools.website)
-- and looks for the staff page on every run without storing it. When it finds the
-- wrong site, or misses the staff page, the client needs to paste the right link, and
-- the scraper should use that link first. Phase 5 step 5.
--
-- What changes: two new columns on schools, both owned by the client and never
-- written by the scraper:
--   website_override     the school's website, as the client set it
--   staff_page_override  the page that lists the school's staff, as the client set it
-- The scraped schools.website is left alone, so it is always possible to see what the
-- scraper found and to go back to it (clear the override). The app shows which link
-- is in use: the override if there is one, otherwise the scraped website.
--
-- Only http(s) links are accepted. Every existing row starts with no override, so no
-- value changes.
--
-- The db/006 edit locks don't need to cover these columns: the scraper's SQL never
-- names them. The scraper reading them first ("read overrides first") is on
-- seandsw's draft-later list; until then they only change what the app shows.
--
-- Snapshot before applying (outside the repo): schools in
--   ~/Desktop/CRM-db-exports/2026-09-30-phase5-step5-before/
-- Reversible: drop the two columns (after exporting any overrides set by then).

begin;

alter table public.schools
  add column if not exists website_override text,
  add column if not exists staff_page_override text;

alter table public.schools
  add constraint schools_website_override_is_a_link
    check (website_override is null or website_override ~* '^https?://[^[:space:]]+$'),
  add constraint schools_staff_page_override_is_a_link
    check (staff_page_override is null or staff_page_override ~* '^https?://[^[:space:]]+$');

comment on column public.schools.website_override is
  'The school website as the client set it. Used instead of the scraped website when present. Never written by the scraper.';
comment on column public.schools.staff_page_override is
  'The page listing the school''s staff, as the client set it. The scraper should read it first. Never written by the scraper.';

commit;
