-- Scan status history, retry link and qc_report contract (issue #17).
-- The contributor's scan page shows a timeline (uploaded -> processing ->
-- failed_qc ...), links a retry to the scan it replaces, and reads QC failure
-- reasons from qc_report.checks. Additive only. Nothing here writes
-- `scans.status`: the trigger records changes the lifecycle module makes.

-- Status history ------------------------------------------------------------

create table public.scan_status_events (
  id          uuid primary key default gen_random_uuid(),
  scan_id     uuid not null references public.scans (id) on delete cascade,
  -- Null for the first row (scan creation).
  from_status public.lifecycle_status,
  to_status   public.lifecycle_status not null,
  created_at  timestamptz not null default now()
);
create index scan_status_events_scan_idx
  on public.scan_status_events (scan_id, created_at);

alter table public.scan_status_events enable row level security;

-- The uploader and reviewers read the timeline. Published scans are public but
-- their history is not: it is only useful to the people working on the scan.
grant select on public.scan_status_events to authenticated;
create policy scan_status_events_read on public.scan_status_events
  for select to authenticated
  using (
    (select private.has_trust('reviewer'))
    or exists (
      select 1 from public.scans s
      where s.id = scan_id and s.uploader_id = (select auth.uid())
    )
  );

create function private.record_scan_status()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.scan_status_events (scan_id, from_status, to_status)
    values (new.id, null, new.status);
  elsif new.status is distinct from old.status then
    insert into public.scan_status_events (scan_id, from_status, to_status)
    values (new.id, old.status, new.status);
  end if;
  return null;
end
$$;
revoke all on function private.record_scan_status from public;

create trigger scans_record_status
  after insert or update of status on public.scans
  for each row execute function private.record_scan_status();

-- Backfill: one event per existing scan, so every scan has a timeline.
insert into public.scan_status_events (scan_id, from_status, to_status, created_at)
select id, null, status, created_at from public.scans;

-- Retry link ----------------------------------------------------------------

-- A retry is a new scan that replaces a failed or rejected one. Set
-- server-side only: authenticated's insert/update column grants don't include it.
alter table public.scans
  add column retry_of uuid references public.scans (id) on delete set null,
  add constraint scans_retry_not_self check (retry_of is null or retry_of <> id);
create index scans_retry_of_idx on public.scans (retry_of) where retry_of is not null;

-- qc_report contract --------------------------------------------------------

-- Shape is enforced in the lifecycle module (assertQcReport); this is the
-- backstop so a row can never hold a report the UI can't render.
alter table public.scans
  add constraint scans_qc_report_has_checks
  check (qc_report is null or jsonb_typeof(qc_report -> 'checks') = 'array');
