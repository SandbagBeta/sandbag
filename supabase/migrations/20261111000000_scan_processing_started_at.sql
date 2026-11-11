-- Detect scans stuck in `processing` (issue #16, ADR 003 §6 "Stuck
-- `processing`", owner decision on #16).
--
-- A scan can sit in `processing` with nothing left to finish it: the worker
-- crashed after claiming and the job was later finished without a status
-- change, or the scan reached `processing` with no job row at all (a manual
-- change). This migration records when a scan entered `processing`, lets the
-- QC route list the scans that have been there too long with no live job, and
-- makes the sweep poke the route when there are any.
--
-- Rules this migration encodes:
-- * This SQL never writes scans.status. The QC route calls
--   list_stuck_qc_scans and moves each scan to failed_qc through the
--   lifecycle module (src/lib/lifecycle, applyTransition).
-- * processing_started_at is maintained by a trigger only. authenticated has
--   no insert/update grant on it (the column grants in 20261110000100 are
--   per-column), and the trigger overwrites it whenever status changes.
-- * status = 'processing' exactly when processing_started_at is set.

-- Column ----------------------------------------------------------------------

alter table public.scans add column processing_started_at timestamptz;

-- Scans already in processing have no start time; count them from now.
update public.scans set processing_started_at = now() where status = 'processing';

alter table public.scans add constraint scans_processing_started_iff_processing
  check ((status = 'processing') = (processing_started_at is not null));

create index scans_processing_started_idx on public.scans (processing_started_at)
  where status = 'processing';

-- On insert, and whenever status changes: set to now() on entering
-- `processing`, null otherwise. An update that leaves status unchanged keeps
-- the value it is given (the check constraint still applies).
create function private.scans_set_processing_started_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.processing_started_at :=
      case when new.status = 'processing' then now() else null end;
  end if;
  return new;
end
$$;
revoke all on function private.scans_set_processing_started_at
  from public, anon, authenticated, service_role;

create trigger scans_processing_started_at
  before insert or update on public.scans
  for each row execute function private.scans_set_processing_started_at();

-- Stuck-scan listing (service_role only) ---------------------------------------

-- Scans in `processing` since before now() - p_older_than_seconds whose
-- active qc_jobs row (if any) is not live. An active job is live, and keeps
-- the scan off this list, when it is running with an unexpired lease, queued
-- with run_after in the future (retry backoff), or was claimed/failed within
-- the threshold (the sweep re-claims expired leases within a minute; this
-- covers that gap). So a row with has_active_job = true means the queue
-- itself has stopped moving that job.
--
-- Read-only. The caller moves each returned scan to failed_qc through the
-- lifecycle module (compare-and-set from processing, so a scan that finished
-- in the meantime is left alone). Oldest first, at most 100 rows; call again
-- after handling them. p_older_than_seconds must be 300-86400 (22023).
create function public.list_stuck_qc_scans(p_older_than_seconds integer default 900)
returns table (scan_id uuid, processing_started_at timestamptz, has_active_job boolean)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_older_than_seconds is null or p_older_than_seconds not between 300 and 86400 then
    raise exception 'list_stuck_qc_scans: older_than_seconds must be between 300 and 86400, got %',
      p_older_than_seconds using errcode = '22023';
  end if;
  return query
    select s.id, s.processing_started_at, j.id is not null
    from public.scans s
    left join private.qc_jobs j on j.scan_id = s.id and j.finished_at is null
    where s.status = 'processing'
      and s.processing_started_at < now() - make_interval(secs => p_older_than_seconds)
      and (j.id is null or not (
        (j.state = 'running' and j.lease_until > now())
        or (j.state = 'queued' and j.run_after > now())
        or j.updated_at >= now() - make_interval(secs => p_older_than_seconds)
      ))
    order by s.processing_started_at, s.id
    limit 100;
end
$$;

revoke all on function public.list_stuck_qc_scans from public, anon, authenticated;
grant execute on function public.list_stuck_qc_scans to service_role;

-- Sweep -------------------------------------------------------------------------

-- Same as 20261110000300, plus: also POSTs when a scan has been stuck in
-- processing for 15 minutes (the default threshold). Still one request per
-- run, still no ids in the body, still a silent no-op without both Vault
-- secrets (or with a secret under 32 chars).
create or replace function private.qc_sweep()
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select s.decrypted_secret into v_url
  from vault.decrypted_secrets s where s.name = 'qc_run_url';
  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s where s.name = 'qc_run_secret';
  if v_url is null or v_url !~ '^https?://' or v_secret is null or length(v_secret) < 32 then
    return null;
  end if;
  if not exists (select 1 from private.qc_jobs j where private.qc_job_is_claimable(j))
     and not exists (select 1 from public.list_stuck_qc_scans(900)) then
    return null;
  end if;
  return net.http_post(
    url := v_url,
    body := '{"source":"sweep"}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 10000
  );
end
$$;
revoke all on function private.qc_sweep from public, anon, authenticated, service_role;
