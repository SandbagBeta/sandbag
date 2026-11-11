-- QC job queue (issue #16, ADR 003): private table, service-role-only
-- functions, one active job per scan, claim order/leases/attempts/backoff,
-- complete/fail, the re-run path, cascade on scan delete, and the Vault-gated
-- sweep. now() is fixed inside this transaction, so leases and backoff are
-- moved into the past with direct updates instead of waiting.
begin;
create extension if not exists pgtap with schema extensions;
select plan(89);

-- Raw key for test scan n (shape of src/lib/upload/keys.ts rawObjectKey).
create function pg_temp.rp(n int) returns text language sql immutable as $$
  select '00000000-0000-0000-0000-0000000000a1/30000000-0000-0000-0000-00000000000'
    || n || '/raw/source.glb'
$$;
create function pg_temp.sid(n int) returns uuid language sql immutable as $$
  select ('30000000-0000-0000-0000-00000000000' || n)::uuid
$$;

-- Shape and location --------------------------------------------------------

select has_table('private', 'qc_jobs', 'qc_jobs lives in the private schema');
select hasnt_table('public', 'qc_jobs', 'qc_jobs is not in the exposed public schema');
select is((select relrowsecurity from pg_class where oid = 'private.qc_jobs'::regclass), true,
  'RLS is enabled on private.qc_jobs');
select columns_are('private', 'qc_jobs', array[
  'id', 'scan_id', 'raw_path', 'state', 'attempts', 'max_attempts', 'run_after',
  'lease_until', 'lease_token', 'last_error', 'pipeline_version', 'created_at',
  'updated_at', 'finished_at'
], 'qc_jobs has exactly the documented columns');
select col_default_is('private', 'qc_jobs', 'max_attempts', '3', 'max_attempts defaults to 3');
select has_function('public', 'enqueue_qc_job', array['uuid', 'text'], 'enqueue_qc_job(uuid, text) exists');
select has_function('public', 'claim_qc_job', array['integer', 'text'], 'claim_qc_job(integer, text) exists');
select has_function('public', 'complete_qc_job', array['uuid', 'uuid'], 'complete_qc_job(uuid, uuid) exists');
select has_function('public', 'fail_qc_job', array['uuid', 'uuid', 'text', 'integer'],
  'fail_qc_job(uuid, uuid, text, integer) exists');
select has_function('private', 'qc_sweep', array[]::text[], 'private.qc_sweep() exists');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like '%qc_job' and p.prosecdef
    and p.proconfig @> array['search_path=""']), 4,
  'queue functions are security definer with an empty search_path');

-- Privileges ----------------------------------------------------------------

select ok(not has_table_privilege(r, 'private.qc_jobs', p), r || ' has no ' || p || ' on qc_jobs')
from unnest(array['anon', 'authenticated', 'service_role']) as r,
     unnest(array['select', 'insert', 'update', 'delete']) as p;

select ok(not has_function_privilege(r, f, 'execute'), r || ' cannot execute ' || f)
from unnest(array['anon', 'authenticated']) as r,
     unnest(array['public.enqueue_qc_job(uuid,text)', 'public.claim_qc_job(integer,text)',
       'public.complete_qc_job(uuid,uuid)', 'public.fail_qc_job(uuid,uuid,text,integer)',
       'private.qc_sweep()']) as f;

select ok(has_function_privilege('service_role', f, 'execute'), 'service_role can execute ' || f)
from unnest(array['public.enqueue_qc_job(uuid,text)', 'public.claim_qc_job(integer,text)',
  'public.complete_qc_job(uuid,uuid)', 'public.fail_qc_job(uuid,uuid,text,integer)']) as f;
select ok(not has_function_privilege('service_role', 'private.qc_sweep()', 'execute'),
  'service_role cannot execute qc_sweep (only pg_cron, as postgres)');

insert into public.scans (id, status) values
  (pg_temp.sid(1), 'uploaded'), (pg_temp.sid(2), 'uploaded'),
  (pg_temp.sid(3), 'uploaded'), (pg_temp.sid(4), 'uploaded');

set local role anon;
select throws_ok('select * from private.qc_jobs', '42501', null, 'anon cannot read qc_jobs');
select throws_ok($$select * from public.enqueue_qc_job('30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-0000000000a1/30000000-0000-0000-0000-000000000001/raw/source.glb')$$,
  '42501', null, 'anon cannot enqueue');
reset role;
set local role authenticated;
select throws_ok($$insert into private.qc_jobs (scan_id, raw_path) values ('30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-0000000000a1/30000000-0000-0000-0000-000000000001/raw/source.glb')$$,
  '42501', null, 'authenticated cannot insert into qc_jobs');
select throws_ok('select * from public.claim_qc_job()', '42501', null, 'authenticated cannot claim');
reset role;

-- Enqueue: one active job per scan, verified raw key ------------------------

select throws_ok($$select * from public.enqueue_qc_job(pg_temp.sid(1), pg_temp.rp(2))$$,
  '23514', null, 'raw_path must belong to the job''s scan');
select throws_ok($$select * from public.enqueue_qc_job(pg_temp.sid(1),
  '00000000-0000-0000-0000-0000000000a1/30000000-0000-0000-0000-000000000001/raw/../x')$$,
  '23514', null, 'raw_path must have the raw key shape');

create temp table t_ids (k text primary key, v uuid) on commit drop;
insert into t_ids select 'j1', job_id from public.enqueue_qc_job(pg_temp.sid(1), pg_temp.rp(1));

select is((select created from public.enqueue_qc_job(pg_temp.sid(1), pg_temp.rp(1))), false,
  'enqueueing again creates nothing');
select is((select job_id from public.enqueue_qc_job(pg_temp.sid(1),
  '00000000-0000-0000-0000-0000000000a1/30000000-0000-0000-0000-000000000001/raw/source.ply')),
  (select v from t_ids where k = 'j1'), 'enqueueing again returns the active job');
select is((select raw_path from private.qc_jobs where id = (select v from t_ids where k = 'j1')),
  pg_temp.rp(1), 'a repeat enqueue does not change raw_path');
select is((select count(*)::int from private.qc_jobs where scan_id = pg_temp.sid(1)), 1,
  'one job row for the scan');
select throws_ok($$insert into private.qc_jobs (scan_id, raw_path) values (pg_temp.sid(1), pg_temp.rp(1))$$,
  '23505', null, 'a second active job for the same scan is rejected');
select row_eq($$select state, attempts, max_attempts, run_after, lease_until, finished_at
  from private.qc_jobs where id = (select v from t_ids where k = 'j1')$$,
  row('queued'::text, 0, 3, now(), null::timestamptz, null::timestamptz),
  'a new job is queued, due now, with 0 of 3 attempts');

insert into t_ids select 'j2', job_id from public.enqueue_qc_job(pg_temp.sid(2), pg_temp.rp(2));
insert into t_ids select 'j3', job_id from public.enqueue_qc_job(pg_temp.sid(3), pg_temp.rp(3));
-- Oldest first: j1, then j2, then j3.
update private.qc_jobs set created_at = now() - interval '30 minutes' where id = (select v from t_ids where k = 'j1');
update private.qc_jobs set created_at = now() - interval '20 minutes' where id = (select v from t_ids where k = 'j2');
update private.qc_jobs set created_at = now() - interval '10 minutes' where id = (select v from t_ids where k = 'j3');

-- Claim ---------------------------------------------------------------------

create temp table t_claims on commit drop as
  select 1 as n, * from public.claim_qc_job(360, 'qc-test-1');
select row_eq($$select job_id, raw_path, attempt, exhausted from t_claims where n = 1$$,
  row((select v from t_ids where k = 'j1'), pg_temp.rp(1), 1, false),
  'claim returns the oldest job with its raw_path, attempt 1');
select row_eq($$select state, lease_until, pipeline_version from private.qc_jobs where id = (select v from t_ids where k = 'j1')$$,
  row('running'::text, now() + interval '360 seconds', 'qc-test-1'::text),
  'claimed job is leased and records the pipeline version');
insert into t_claims select 2, * from public.claim_qc_job();
select is((select job_id from t_claims where n = 2), (select v from t_ids where k = 'j2'),
  'second claim skips the leased job and takes the next oldest');
insert into t_claims select 3, * from public.claim_qc_job();
select is((select job_id from t_claims where n = 3), (select v from t_ids where k = 'j3'), 'third claim takes j3');
select is_empty('select * from public.claim_qc_job()', 'nothing claimable while every lease is live');
select throws_ok('select * from public.claim_qc_job(5)', '22023', null, 'lease_seconds is bounds-checked');

-- Infrastructure failure on attempt 1: back to queued, 1 minute backoff.
select is(public.fail_qc_job((select v from t_ids where k = 'j2'), (select lease_token from t_claims where n = 2),
  'storage 503'), 'queued', 'infrastructure failure with attempts left re-queues');
select is((select run_after from private.qc_jobs where id = (select v from t_ids where k = 'j2')),
  now() + interval '60 seconds', 'first retry waits 1 minute');

-- Worker killed (expired lease): re-claimed with a new token and the next attempt.
update private.qc_jobs set lease_until = now() - interval '1 second' where id = (select v from t_ids where k = 'j1');
insert into t_claims select 4, * from public.claim_qc_job();
select row_eq($$select job_id, attempt from t_claims where n = 4$$,
  row((select v from t_ids where k = 'j1'), 2), 'expired lease is re-claimed as attempt 2');
select isnt((select lease_token from t_claims where n = 4), (select lease_token from t_claims where n = 1),
  're-claim issues a new lease token');
select is(public.complete_qc_job((select v from t_ids where k = 'j1'), (select lease_token from t_claims where n = 1)),
  false, 'the stale worker cannot complete with its old token');

-- Infrastructure failure on attempt 2: 5 minute backoff; sanitized error.
select is(public.fail_qc_job((select v from t_ids where k = 'j1'), (select lease_token from t_claims where n = 4),
  E'storage 503\n' || repeat('x', 600)), 'queued', 'second infrastructure failure re-queues');
select row_eq($$select state, run_after, lease_until, lease_token, finished_at from private.qc_jobs
  where id = (select v from t_ids where k = 'j1')$$,
  row('queued'::text, now() + interval '300 seconds', null::timestamptz, null::uuid, null::timestamptz),
  'second retry waits 5 minutes and the lease is released');
select ok((select length(last_error) = 500 and last_error !~ '[[:cntrl:]]' and last_error like 'storage 503 x%'
  from private.qc_jobs where id = (select v from t_ids where k = 'j1')),
  'last_error is truncated to 500 chars with control characters removed');
select is_empty('select * from public.claim_qc_job()', 'jobs in backoff are not claimable yet');

update private.qc_jobs set run_after = now() - interval '1 second' where id = (select v from t_ids where k = 'j1');
insert into t_claims select 5, * from public.claim_qc_job();
select row_eq($$select job_id, attempt, exhausted from t_claims where n = 5$$,
  row((select v from t_ids where k = 'j1'), 3, false), 'after backoff the job is claimed as attempt 3');
select is(public.fail_qc_job((select v from t_ids where k = 'j1'), (select lease_token from t_claims where n = 5),
  'storage 503'), 'failed', 'infrastructure failure on the last attempt finishes the job as failed');
select ok((select finished_at is not null and attempts = 3 from private.qc_jobs where id = (select v from t_ids where k = 'j1')),
  'the job stops at max_attempts');

-- Maintainer re-run: a fresh job for the same scan once the old one finished.
insert into t_ids select 'j1b', job_id from public.enqueue_qc_job(pg_temp.sid(1), pg_temp.rp(1));
select isnt((select v from t_ids where k = 'j1b'), (select v from t_ids where k = 'j1'),
  'after the job finished, the same scan gets a new job');
select row_eq($$select state, attempts from private.qc_jobs where id = (select v from t_ids where k = 'j1b')$$,
  row('queued'::text, 0), 'the re-run job starts at 0 attempts');
select is((select count(*)::int from private.qc_jobs where scan_id = pg_temp.sid(1)), 2,
  'the finished job is kept as history');

-- Crash on the final attempt: the expired lease is handed out as exhausted,
-- without another attempt.
update private.qc_jobs set state = 'running', attempts = 3, lease_until = now() - interval '1 second',
  lease_token = gen_random_uuid() where id = (select v from t_ids where k = 'j2');
insert into t_claims select 6, * from public.claim_qc_job();
select row_eq($$select job_id, attempt, exhausted from t_claims where n = 6$$,
  row((select v from t_ids where k = 'j2'), 3, true), 'expired last attempt is claimed as exhausted, attempts unchanged');
select is(public.fail_qc_job((select v from t_ids where k = 'j2'), (select lease_token from t_claims where n = 6),
  'worker lost on final attempt'), 'failed', 'exhausted job is finished as failed');

-- Genuine mesh failure is a verdict: completed on the first attempt, no retry.
insert into t_claims select 7, * from public.claim_qc_job();
select row_eq($$select job_id, attempt from t_claims where n = 7$$,
  row((select v from t_ids where k = 'j1b'), 1), 'the re-run job is claimed as attempt 1');
select is(public.complete_qc_job((select v from t_ids where k = 'j1b'), (select lease_token from t_claims where n = 7)),
  true, 'a mesh failure finishes the job through complete_qc_job');
select row_eq($$select state, attempts from private.qc_jobs where id = (select v from t_ids where k = 'j1b')$$,
  row('done'::text, 1), 'mesh failure job is done after one attempt');

-- Complete.
select is(public.complete_qc_job((select v from t_ids where k = 'j3'), (select lease_token from t_claims where n = 3)),
  true, 'the lease holder completes its job');
select row_eq($$select state, lease_until, lease_token, finished_at is not null from private.qc_jobs
  where id = (select v from t_ids where k = 'j3')$$,
  row('done'::text, null::timestamptz, null::uuid, true), 'completed job is done, finished and unleased');
select is(public.complete_qc_job((select v from t_ids where k = 'j3'), (select lease_token from t_claims where n = 3)),
  false, 'completing twice is a no-op');
select is(public.fail_qc_job((select v from t_ids where k = 'j3'), (select lease_token from t_claims where n = 3),
  'late'), null, 'failing a finished job is a no-op');
select is_empty('select * from public.claim_qc_job()', 'finished jobs are never claimed');

-- Cascade.
delete from public.scans where id = pg_temp.sid(3);
select is((select count(*)::int from private.qc_jobs where scan_id = pg_temp.sid(3)), 0,
  'deleting a scan deletes its jobs');

-- Sweep -----------------------------------------------------------------------

select is((select count(*)::int from cron.job where jobname = 'qc-sweep'
  and schedule = '* * * * *' and command = 'select private.qc_sweep()'), 1,
  'pg_cron runs the sweep every minute');

delete from vault.secrets where name in ('qc_run_url', 'qc_run_secret');
select is(private.qc_sweep(), null, 'no Vault secrets and nothing claimable: no-op');
insert into t_ids select 'j4', job_id from public.enqueue_qc_job(pg_temp.sid(4), pg_temp.rp(4));
select is(private.qc_sweep(), null, 'claimable job but no Vault secrets: no-op');
do $$ begin perform vault.create_secret('http://host.docker.internal:3000/api/qc/run', 'qc_run_url'); end $$;
select is(private.qc_sweep(), null, 'URL without secret: no-op');
do $$ begin perform vault.create_secret('too-short', 'qc_run_secret'); end $$;
select is(private.qc_sweep(), null, 'secret under 32 characters: no-op');
do $$ begin perform vault.update_secret((select id from vault.secrets where name = 'qc_run_secret'), repeat('s', 40)); end $$;
select isnt(private.qc_sweep(), null, 'configured and a job is claimable: one request is queued');
update private.qc_jobs set run_after = now() + interval '1 hour' where scan_id = pg_temp.sid(4);
select is(private.qc_sweep(), null, 'configured but nothing claimable: no request');

select * from finish();
rollback;
