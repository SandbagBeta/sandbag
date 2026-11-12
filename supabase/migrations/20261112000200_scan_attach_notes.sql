-- Freetext "can't find it" note on a scan (issue #28). When a contributor
-- can't find their boulder or area in OpenBeta they describe it in words, so a
-- reviewer can match it. Additive only.
--
-- Separate table, not a scans column: published scan rows are public in full,
-- and free text can carry coordinates or a secret spot's directions (PRD §2,
-- access privacy). Here only the uploader and reviewers can read it, it is
-- never exported, and a backstop check refuses coordinate-looking pairs. The
-- app must also validate before writing and never render it publicly.

create table public.scan_attach_notes (
  scan_id    uuid primary key references public.scans (id) on delete cascade,
  note       text not null
    check (length(trim(note)) between 1 and 500)
    -- Backstop: two decimal numbers in a row look like "lat, lng".
    check (note !~ '-?\d{1,3}\.\d{3,}\s*[,;/ ]\s*-?\d{1,3}\.\d{3,}'),
  updated_at timestamptz not null default now()
);

alter table public.scan_attach_notes enable row level security;
-- Defense in depth: anon never touches this table, whatever policies say.
revoke all on public.scan_attach_notes from anon;

grant select on public.scan_attach_notes to authenticated;
grant insert (scan_id, note) on public.scan_attach_notes to authenticated;
grant update (note) on public.scan_attach_notes to authenticated;

create policy scan_attach_notes_read on public.scan_attach_notes
  for select to authenticated
  using (
    (select private.has_trust('reviewer'))
    or exists (select 1 from public.scans s
      where s.id = scan_id and s.uploader_id = (select auth.uid()))
  );
-- The uploader writes while the scan is still unpublished.
create policy scan_attach_notes_insert_own on public.scan_attach_notes
  for insert to authenticated
  with check (exists (select 1 from public.scans s
    where s.id = scan_id and s.uploader_id = (select auth.uid())
      and s.status in ('uploaded', 'failed_qc', 'pending_review')));
create policy scan_attach_notes_update_own on public.scan_attach_notes
  for update to authenticated
  using (exists (select 1 from public.scans s
    where s.id = scan_id and s.uploader_id = (select auth.uid())
      and s.status in ('uploaded', 'failed_qc', 'pending_review')))
  with check (exists (select 1 from public.scans s
    where s.id = scan_id and s.uploader_id = (select auth.uid())
      and s.status in ('uploaded', 'failed_qc', 'pending_review')));

create function private.touch_scan_attach_note()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
revoke all on function private.touch_scan_attach_note from public;
create trigger scan_attach_notes_touch
  before update on public.scan_attach_notes
  for each row execute function private.touch_scan_attach_note();
