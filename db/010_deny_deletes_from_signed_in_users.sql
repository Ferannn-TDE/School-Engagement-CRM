-- 010 — The database refuses deletes from signed-in users, on every table
--
-- Why: the no-loss rule. Since db/009 the app archives instead of deleting (no
-- .delete() is left in src). This makes it a guarantee at the database: a delete
-- sent with a signed-in user's token removes nothing, whatever the app or a script
-- using the app's key does. Phase 5 step 8, applied last on purpose, after archive
-- was built and proven (a restrictive policy filters rows silently, so an app delete
-- left in place would have looked like it worked and then come back on reload).
--
-- Same pattern as db/001, which already covers district, county and state: a
-- RESTRICTIVE policy is AND-ed with the existing permissive ones, so using (false)
-- denies DELETE while SELECT, INSERT and UPDATE stay exactly as they are. The aal2
-- rule (db/003) and the bulk-delete guard (db/002) stay in place as further layers.
--
-- Not affected:
--   * The scraper. It connects as the table owner (confirmed by seandsw 2026-09-07),
--     and the owner bypasses RLS (no table uses FORCE ROW LEVEL SECURITY).
--   * The SQL Editor, which runs as the owner too.
--   * anon, which has no DELETE privilege on these tables at all.
--
-- No stored data changes. Snapshot of the policies before applying (outside the repo):
--   ~/Desktop/CRM-db-exports/2026-09-29-phase5-step8-before/policies_before_010.txt
-- Reversible: drop the six "deny delete" policies below.

begin;

create policy "deny delete" on public.schools
  as restrictive for delete to authenticated using (false);
create policy "deny delete" on public.staff
  as restrictive for delete to authenticated using (false);
create policy "deny delete" on public.contacts
  as restrictive for delete to authenticated using (false);
create policy "deny delete" on public.events
  as restrictive for delete to authenticated using (false);
create policy "deny delete" on public.programs
  as restrictive for delete to authenticated using (false);
create policy "deny delete" on public.activities
  as restrictive for delete to authenticated using (false);

commit;

-- Review: every table in public has one restrictive DELETE policy, and none forces RLS.
--   select c.relname, c.relforcerowsecurity,
--          exists (select 1 from pg_policies p where p.schemaname = 'public'
--                  and p.tablename = c.relname and p.cmd = 'DELETE'
--                  and p.permissive = 'RESTRICTIVE') as deny_delete
--   from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
--   order by 1;
