-- QC job queue (issue #16, schema PR; ADR 003 O1/O2/O3/O8, §5 Q1, §6).
--
-- QC runs in Node inside the Next.js app behind a secret-protected route
-- (ADR 003 O1). This migration gives it a private job table, service-role-only
-- functions to enqueue/claim/finish jobs, and a pg_cron + pg_net sweep that
-- pokes the route when a job is due (Vercel Hobby cron runs once a day, so
-- recovery can't depend on it). The full contract, with the Vault setup, is in
-- supabase/README.md "QC job queue".
--
-- Rules this migration encodes:
-- * qc_jobs lives in `private`, which PostgREST doesn't expose, and no API
--   role has any privilege on it. Errors and attempt history stay off the
--   public `scans` row.
-- * The app reaches the queue only through the four public.*_qc_job functions
--   below (PostgREST can only call functions in exposed schemas). They are
--   security definer and executable by service_role only.
-- * At most one active (unfinished) job per scan. A finished job doesn't block
--   a new one, so a failed_qc scan can be re-run with a fresh job (O3).
-- * This SQL never touches scans.status. Status moves only through the
--   lifecycle module (src/lib/lifecycle).
-- * Retries are for infrastructure errors only (O8): the app calls
--   fail_qc_job for those (Storage 5xx, DB timeout; an OOM or timeout shows up
--   as an expired lease). A genuine mesh failure is a QC verdict, so the app
--   finishes the job with complete_qc_job, same as a pass.
-- * last_error is a short, single-line message for operators. Callers must
--   never pass raw file bytes, parser dumps, or coordinates. The functions
--   truncate it to 500 characters and strip control characters.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Table ----------------------------------------------------------------------

create table private.qc_jobs (
  id               uuid primary key default gen_random_uuid(),
  scan_id          uuid not null references public.scans (id) on delete cascade,
  -- Storage key of the verified raw upload in the `uploads` bucket
  -- ({uploader_id}/{scan_id}/raw/source.<ext>, src/lib/upload/keys.ts), set by
  -- enqueueQc from the object it checked, never from client input. The worker
  -- copies it to scans.raw_path through the lifecycle patch.
  raw_path         text not null
                   check (raw_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/raw/source\.[a-z0-9]{1,8}$'),
  -- queued: waiting (new, or an infrastructure retry until run_after).
  -- running: leased to a worker until lease_until.
  -- done: QC reached a verdict (pass or mesh failure).
  -- failed: infrastructure retries exhausted.
  -- done/failed are finished and never claimed again.
  state            text not null default 'queued'
                   check (state in ('queued', 'running', 'done', 'failed')),
  attempts         integer not null default 0 check (attempts >= 0),
  max_attempts     integer not null default 3 check (max_attempts between 1 and 10),
  -- Earliest time a queued job may be claimed (retry backoff).
  run_after        timestamptz not null default now(),
  lease_until      timestamptz,
  -- Fencing token, new on every claim. complete/fail must present it, so a
  -- worker whose lease expired and was re-claimed can't finish the job.
  lease_token      uuid,
  last_error       text check (last_error is null or length(last_error) <= 500),
  -- Version of the QC pipeline that ran the latest attempt (set at claim).
  pipeline_version text check (pipeline_version is null or length(pipeline_version) <= 64),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finished_at      timestamptz,
  constraint qc_jobs_attempts_le_max check (attempts <= max_attempts),
  -- The key's scan segment must be this job's scan.
  constraint qc_jobs_raw_path_matches_scan
    check (split_part(raw_path, '/', 2) = scan_id::text),
  constraint qc_jobs_finished_iff_terminal
    check ((state in ('done', 'failed')) = (finished_at is not null)),
  constraint qc_jobs_lease_iff_running
    check ((state = 'running') = (lease_until is not null and lease_token is not null))
);

-- One active job per scan; `enqueue_qc_job` relies on it for idempotency.
create unique index qc_jobs_one_active_per_scan on private.qc_jobs (scan_id)
  where finished_at is null;
create index qc_jobs_active_created_idx on private.qc_jobs (created_at, id)
  where finished_at is null;

alter table private.qc_jobs enable row level security;
-- No policies: no API role may touch the table, even if `private` were exposed.
revoke all on private.qc_jobs from public, anon, authenticated, service_role;

-- Claimable: queued and due with attempts left, or running with an expired
-- lease. An expired lease with no attempts left is still claimable, but as
-- `exhausted`: the claimer must not run QC again, only record the failure.
create function private.qc_job_is_claimable(j private.qc_jobs)
returns boolean language sql stable set search_path = ''
as $$
  select j.finished_at is null and (
    (j.state = 'queued' and j.run_after <= now() and j.attempts < j.max_attempts)
    or (j.state = 'running' and j.lease_until <= now())
  )
$$;
revoke all on function private.qc_job_is_claimable from public, anon, authenticated;

-- Queue API (service_role only) ------------------------------------------------

-- Idempotent: returns the scan's active job, creating it (attempts 0) if there
-- is none. While a job is active a repeat call changes nothing, raw_path
-- included. After the previous job finished it creates a fresh one, which is
-- the maintainer re-run path (O3).
create function public.enqueue_qc_job(p_scan_id uuid, p_raw_path text)
returns table (job_id uuid, created boolean)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into private.qc_jobs (scan_id, raw_path) values (p_scan_id, p_raw_path)
  on conflict (scan_id) where finished_at is null do nothing
  returning id into v_id;
  if v_id is not null then
    return query select v_id, true;
    return;
  end if;
  return query
    select j.id, false from private.qc_jobs j
    where j.scan_id = p_scan_id and j.finished_at is null;
end
$$;

-- Atomically leases the oldest claimable job (for update skip locked, so two
-- workers never get the same job). Zero rows when nothing is claimable.
-- `attempt` counts this run (1-based). `exhausted` = true means the previous
-- attempt died on its last try (lease expired): don't run QC; move the scan to
-- failed_qc via the lifecycle module ("something went wrong on our side"),
-- then call fail_qc_job, which finishes the job as `failed`.
create function public.claim_qc_job(
  p_lease_seconds integer default 360,
  p_pipeline_version text default null
)
returns table (
  job_id uuid, scan_id uuid, raw_path text, attempt integer, max_attempts integer,
  lease_until timestamptz, lease_token uuid, exhausted boolean
)
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then
    raise exception 'claim_qc_job: lease_seconds must be between 30 and 3600, got %',
      p_lease_seconds using errcode = '22023';
  end if;
  return query
    with candidate as (
      select c.id, c.attempts as prev_attempts
      from private.qc_jobs c
      where private.qc_job_is_claimable(c)
      order by c.created_at, c.id
      limit 1
      for update skip locked
    )
    update private.qc_jobs j set
      attempts = least(j.attempts + 1, j.max_attempts),
      state = 'running',
      lease_until = now() + make_interval(secs => p_lease_seconds),
      lease_token = gen_random_uuid(),
      pipeline_version = coalesce(left(p_pipeline_version, 64), j.pipeline_version),
      updated_at = now()
    from candidate
    where j.id = candidate.id
    returning j.id, j.scan_id, j.raw_path, j.attempts, j.max_attempts, j.lease_until,
      j.lease_token, candidate.prev_attempts >= j.max_attempts;
end
$$;

-- Finishes a leased job as `done`: QC reached a verdict, pass or genuine mesh
-- failure (no retry for those). False when the token doesn't match the
-- current lease (re-claimed or already finished); the caller should stop.
create function public.complete_qc_job(p_job_id uuid, p_lease_token uuid)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
begin
  update private.qc_jobs set
    state = 'done', finished_at = now(), updated_at = now(),
    lease_until = null, lease_token = null
  where id = p_job_id and state = 'running' and lease_token = p_lease_token;
  return found;
end
$$;

-- Records an infrastructure failure and releases the lease. With attempts
-- left, the job goes back to `queued` until run_after = now() + backoff:
-- p_retry_after_seconds if given, else 60 s after attempt 1 and 300 s after
-- attempt 2 (ADR 003 §6). With none left it is finished as `failed`, and the
-- app moves the scan to failed_qc. Returns the new state ('queued' or
-- 'failed'), or null if the token doesn't match the current lease.
create function public.fail_qc_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retry_after_seconds integer default null
)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_error text := left(
    nullif(btrim(regexp_replace(coalesce(p_error, ''), '[[:cntrl:]]+', ' ', 'g')), ''),
    500);
  v_state text;
begin
  if p_retry_after_seconds is not null and p_retry_after_seconds not between 0 and 86400 then
    raise exception 'fail_qc_job: retry_after_seconds must be between 0 and 86400, got %',
      p_retry_after_seconds using errcode = '22023';
  end if;
  update private.qc_jobs j set
    state = case when j.attempts < j.max_attempts then 'queued' else 'failed' end,
    run_after = case when j.attempts < j.max_attempts
                     then now() + make_interval(secs => coalesce(p_retry_after_seconds,
                       case when j.attempts <= 1 then 60 else 300 end))
                     else j.run_after end,
    finished_at = case when j.attempts < j.max_attempts then null else now() end,
    last_error = coalesce(v_error, 'unspecified error'),
    lease_until = null, lease_token = null, updated_at = now()
  where j.id = p_job_id and j.state = 'running' and j.lease_token = p_lease_token
  returning j.state into v_state;
  return v_state;
end
$$;

-- Supabase grants new public functions to anon/authenticated by default, so
-- revoke explicitly, not just from public.
revoke all on function public.enqueue_qc_job, public.claim_qc_job,
  public.complete_qc_job, public.fail_qc_job from public, anon, authenticated;
grant execute on function public.enqueue_qc_job, public.claim_qc_job,
  public.complete_qc_job, public.fail_qc_job to service_role;

-- Sweep (pg_cron + pg_net) ----------------------------------------------------

-- If a job is claimable, POSTs {"source":"sweep"} to the QC route. The URL and
-- bearer secret come from Vault secrets `qc_run_url` and `qc_run_secret`; they
-- are never in this file. Without both (or with a secret under 32 chars) it is
-- a silent no-op. The body carries no ids: the route claims through
-- claim_qc_job. Returns the pg_net request id, or null when nothing was sent.
create function private.qc_sweep()
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
  if not exists (select 1 from private.qc_jobs j where private.qc_job_is_claimable(j)) then
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

-- Every minute; cron.schedule upserts by name, so re-applying is safe.
select cron.schedule('qc-sweep', '* * * * *', 'select private.qc_sweep()');
-- pg_cron logs every run; keep a week of this job's history.
select cron.schedule('qc-sweep-log-purge', '17 3 * * *', $$
  delete from cron.job_run_details
  where jobid = (select jobid from cron.job where jobname = 'qc-sweep')
    and end_time < now() - interval '7 days'
$$);
