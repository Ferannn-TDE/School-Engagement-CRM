-- 012 — Let the client resolve a locked field: use the website's value, or keep theirs
--
-- Why: db/006 locks every field a person edits, and parks what the scraper finds for
-- a locked field in pending_scraped. Phase 5 step 4b adds the screen that asks
-- "The website now says X — keep yours or use this?". Two things in 006 got in the
-- way, so this revises its trigger function (the triggers themselves are unchanged):
--
--   1. "Use this" must apply the value AND remove the lock. Under 006 an app update
--      that changes a column always locks it, so applying the value re-locked it.
--      Now: an app update that sets a column to exactly the value waiting in
--      pending_scraped, and removes that entry in the same update, is accepting the
--      website's value, so the column is unlocked instead of locked.
--
--   2. "Keep yours" must stay answered. The app marks the entry dismissed (with who
--      and when) instead of removing it. Under 006 the next scraper run rewrote the
--      entry and the question came back every run. Now: if the scraper finds the SAME
--      value again, the dismissed entry is kept as it is (only seen_at moves on); a
--      DIFFERENT value replaces it and asks again.
--
-- Everything else is exactly as in 006: any other app edit locks the column; the
-- scraper (no sign-in claims) never changes a locked column; nothing is lost, since
-- what the scraper found always stays in pending_scraped until someone resolves it.
--
-- pending_scraped entries now look like
--   {"phone": {"value": "...", "seen_at": "...",
--              "dismissed": true, "dismissed_at": "...", "dismissed_by": "..."}}
-- (the last three only once someone chose "keep yours").
--
-- No stored data changes. Snapshot of the previous function (identical to db/006):
--   ~/Desktop/CRM-db-exports/2026-09-29-phase5-step4b-before/protect_manual_edits_before_012.sql
-- UNDO: run that file (create or replace; the triggers don't need to change).

begin;

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
  entry jsonb;
  col text;
begin
  if from_app then
    foreach col in array protected loop
      if old.pending_scraped ? col
         and not (new.pending_scraped ? col)
         and new_row -> col = old.pending_scraped -> col -> 'value' then
        -- Accepting the website's value ("use this"): unlock the column. This also
        -- covers a field that already holds that value, where nothing changes.
        new.manual_fields := array_remove(new.manual_fields, col);
      elsif new_row -> col is distinct from old_row -> col
            and not (col = any (new.manual_fields)) then
        -- A person changed this: lock it. manual_fields is taken from the update, so
        -- the app can also unlock a column deliberately by removing it.
        new.manual_fields := array_append(new.manual_fields, col);
      end if;
    end loop;
    return new;
  end if;

  -- The scraper (or any connection without sign-in claims): keep every locked column
  -- as the person left it, and park what the scraper wanted to write.
  foreach col in array old.manual_fields loop
    if new_row -> col is distinct from old_row -> col then
      entry := old.pending_scraped -> col;
      if entry is not null
         and coalesce((entry ->> 'dismissed')::boolean, false)
         and entry -> 'value' = new_row -> col then
        -- Same value the person already said to ignore: keep their answer.
        pending := pending || jsonb_build_object(col, entry || jsonb_build_object('seen_at', now()));
      else
        pending := pending || jsonb_build_object(
          col, jsonb_build_object('value', new_row -> col, 'seen_at', now())
        );
      end if;
      new_row := jsonb_set(new_row, array[col], old_row -> col);
    end if;
  end loop;
  new := jsonb_populate_record(new, new_row);
  new.manual_fields := old.manual_fields;
  new.pending_scraped := pending;
  return new;
end;
$fn$;

commit;
