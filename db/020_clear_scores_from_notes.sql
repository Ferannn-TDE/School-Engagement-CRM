-- 020 — Clear the scraper's old scores out of staff notes (approved 2026-10-01)
--
-- Why: the scraper used to write its confidence score (e.g. "8.54") into notes, the
-- field people use for their own notes. Since db/014 and db/018 the score has its own
-- column, scraper_score, and every score was copied there. The copies in notes are
-- now just noise in a person's notes.
--
-- What changes: notes is set to NULL only where it is a plain number exactly equal to
-- that person's scraper_score. Any note with other text is left exactly as it is
-- (e.g. the nine archived duplicates, whose notes say what they were merged into).
-- Every cleared note is saved first in backup.notes_scores_20261001.
--
-- No lock: run without sign-in claims, the db/006/012 trigger writes unlocked columns
-- and adds no lock. A note that is locked (a person edited it) is never matched here:
-- the migration refuses if one would be.
--
-- Snapshot (outside the repo): ~/Desktop/CRM-db-exports/2026-10-01-notes-before/staff.json
-- UNDO: update public.staff s set notes = b.notes from backup.notes_scores_20261001 b
--       where b.staff_id = s.staff_id;

begin;

create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;

create table backup.notes_scores_20261001 as
select staff_id, notes, scraper_score, now() as saved_at
  from public.staff
 where notes ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
   and scraper_score is not null
   and btrim(notes)::numeric = scraper_score;
alter table backup.notes_scores_20261001 add primary key (staff_id);
alter table backup.notes_scores_20261001 enable row level security;
revoke all on backup.notes_scores_20261001 from public, anon, authenticated;

do $check$
declare locked int;
begin
  select count(*) into locked from public.staff s
    join backup.notes_scores_20261001 b using (staff_id)
   where 'notes' = any (s.manual_fields);
  if locked > 0 then
    raise exception '% of these notes are locked by a person; nothing was cleared.', locked;
  end if;
end $check$;

update public.staff s
   set notes = null
  from backup.notes_scores_20261001 b
 where b.staff_id = s.staff_id;

do $count$
declare saved int; still int;
begin
  select count(*) into saved from backup.notes_scores_20261001;
  select count(*) into still from public.staff s join backup.notes_scores_20261001 b using (staff_id)
   where s.notes is not null;
  if still > 0 then
    raise exception '% saved note(s) were not cleared; nothing was changed.', still;
  end if;
  raise notice 'Cleared % notes (expected 4,343 on 2026-10-01).', saved;
end $count$;

commit;
