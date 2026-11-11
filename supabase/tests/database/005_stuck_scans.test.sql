-- Stuck `processing` scans (issue #16, ADR 003 §6): the processing_started_at
-- trigger and invariant, its column privileges, list_stuck_qc_scans (live-job
-- exclusions, threshold, bounds, ordering, limit, privileges) and the extended
-- sweep. now() is fixed inside this transaction, so start times, leases and
-- job activity are moved into the past with direct updates.
begin;
create extension if not exists pgtap with schema extensions;
select plan(56);

create function pg_temp.sid(n int) returns uuid language sql immutable as $$
  select ('50000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.rp(n int) returns text language sql immutable as $$
  select '00000000-0000-0000-0000-0000000000a5/' || pg_temp.sid(n) || '/raw/source.glb'
$$;
create function pg_temp.started(n int) returns timestamptz language sql stable as $$
  select processing_started_at from public.scans where id = pg_temp.sid(n)
$$;
-- Puts scan n in processing, started `ago` before now().
create function pg_temp.processing_since(n int, ago interval) returns void language sql as $$
  insert into public.scans (id, status) values (pg_temp.sid(n), 'processing');
  update public.scans set processing_started_at = now() - ago where id = pg_temp.sid(n);
$$;

-- Shape -----------------------------------------------------------------------

select has_column('public', 'scans', 'processing_started_at', 'scans.processing_started_at exists');
select col_type_is('public', 'scans', 'processing_started_at', 'timestamp with time zone',
  'processing_started_at is timestamptz');
select col_is_null('public', 'scans', 'processing_started_at', 'processing_started_at is nullable');
select has_trigger('public', 'scans', 'scans_processing_started_at', 'the start-time trigger exists');
select has_function('public', 'list_stuck_qc_scans', array['integer'], 'list_stuck_qc_scans(integer) exists');
select ok((select prosecdef and proconfig @> array['search_path=""'] and provolatile = 's'
  from pg_proc where oid = 'public.list_stuck_qc_scans(integer)'::regprocedure),
  'list_stuck_qc_scans is stable, security definer, with an empty search_path');

-- Column privileges -----------------------------------------------------------

select ok(not has_column_privilege(r, 'public.scans', 'processing_started_at', p),
  r || ' has no ' || p || ' on scans.processing_started_at')
from unnest(array['anon', 'authenticated']) as r, unnest(array['insert', 'update']) as p;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a5', 'a5@example.invalid');
insert into public.profiles (id, handle, trust_level)
values ('00000000-0000-0000-0000-0000000000a5', 'user_a5', 'contributor');
insert into public.scans (id, uploader_id, status)
values (pg_temp.sid(90), '00000000-0000-0000-0000-0000000000a5', 'uploaded');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5"}', true);
select throws_ok($$update public.scans set processing_started_at = now() - interval '1 day'
  where id = '50000000-0000-0000-0000-000000000090'$$,
  '42501', null, 'authenticated cannot update processing_started_at on its own scan');
select throws_ok($$insert into public.scans (uploader_id, processing_started_at)
  values ('00000000-0000-0000-0000-0000000000a5', now())$$,
  '42501', null, 'authenticated cannot insert processing_started_at');
select lives_ok($$update public.scans set capture_app = 'Polycam'
  where id = '50000000-0000-0000-0000-000000000090'$$,
  'authenticated can still update its allowed columns (trigger does not get in the way)');
reset role;
select is((select capture_app from public.scans where id = pg_temp.sid(90)), 'Polycam',
  'the owner''s update was applied');

-- Trigger ---------------------------------------------------------------------

insert into public.scans (id, status, processing_started_at)
values (pg_temp.sid(1), 'uploaded', now() - interval '1 day');
select is(pg_temp.started(1), null, 'insert as uploaded: null, even if a value is supplied');
update public.scans set status = 'processing' where id = pg_temp.sid(1);
select is(pg_temp.started(1), now(), 'uploaded -> processing sets it to now()');
update public.scans set processing_started_at = now() - interval '1 hour' where id = pg_temp.sid(1);
update public.scans set capture_app = 'x' where id = pg_temp.sid(1);
select is(pg_temp.started(1), now() - interval '1 hour', 'an update that keeps status keeps the start time');
update public.scans set status = 'failed_qc' where id = pg_temp.sid(1);
select is(pg_temp.started(1), null, 'processing -> failed_qc clears it');
update public.scans set status = 'processing' where id = pg_temp.sid(1);
select is(pg_temp.started(1), now(), 'failed_qc -> processing (re-run) sets a fresh start time');
update public.scans set status = 'pending_review' where id = pg_temp.sid(1);
select is(pg_temp.started(1), null, 'processing -> pending_review clears it');

insert into public.scans (id, status) values (pg_temp.sid(2), 'processing');
select is(pg_temp.started(2), now(), 'insert directly as processing sets it');
update public.scans set status = 'failed_qc', processing_started_at = now() where id = pg_temp.sid(2);
select is(pg_temp.started(2), null, 'a status change overrides a supplied value');
select throws_ok($$update public.scans set processing_started_at = now()
  where id = '50000000-0000-0000-0000-000000000002'$$,
  '23514', null, 'a non-processing scan cannot carry a start time');
update public.scans set status = 'processing' where id = pg_temp.sid(2);
select throws_ok($$update public.scans set processing_started_at = null
  where id = '50000000-0000-0000-0000-000000000002'$$,
  '23514', null, 'a processing scan must carry a start time');
delete from public.scans where id in (pg_temp.sid(1), pg_temp.sid(2));

-- list_stuck_qc_scans ---------------------------------------------------------

-- 11: stuck 20 min, no job at all.
select pg_temp.processing_since(11, interval '20 minutes');
-- 12: 20 min, job running with a live lease (worker still on it).
select pg_temp.processing_since(12, interval '20 minutes');
insert into private.qc_jobs (scan_id, raw_path, state, attempts, lease_until, lease_token, updated_at)
values (pg_temp.sid(12), pg_temp.rp(12), 'running', 1, now() + interval '2 minutes',
  gen_random_uuid(), now() - interval '20 minutes');
-- 13: in processing for only 6 minutes, no job.
select pg_temp.processing_since(13, interval '6 minutes');
-- 14: 20 min, its only job finished (crash between finishing the job and the
-- status change).
select pg_temp.processing_since(14, interval '20 minutes');
insert into private.qc_jobs (scan_id, raw_path, state, attempts, finished_at, updated_at)
values (pg_temp.sid(14), pg_temp.rp(14), 'done', 1, now() - interval '18 minutes', now() - interval '18 minutes');
-- 15: 20 min, lease just expired, claimed a minute ago (sweep re-claims next).
select pg_temp.processing_since(15, interval '20 minutes');
insert into private.qc_jobs (scan_id, raw_path, state, attempts, lease_until, lease_token, updated_at)
values (pg_temp.sid(15), pg_temp.rp(15), 'running', 1, now() - interval '1 second',
  gen_random_uuid(), now() - interval '1 minute');
-- 16: 30 min, lease expired long ago and nothing re-claimed it (queue wedged).
select pg_temp.processing_since(16, interval '30 minutes');
insert into private.qc_jobs (scan_id, raw_path, state, attempts, lease_until, lease_token, updated_at)
values (pg_temp.sid(16), pg_temp.rp(16), 'running', 1, now() - interval '24 minutes',
  gen_random_uuid(), now() - interval '30 minutes');
-- 17: 20 min, queued in a long retry backoff.
select pg_temp.processing_since(17, interval '20 minutes');
insert into private.qc_jobs (scan_id, raw_path, state, attempts, run_after, updated_at)
values (pg_temp.sid(17), pg_temp.rp(17), 'queued', 1, now() + interval '1 hour', now() - interval '20 minutes');
-- 18: not in processing.
insert into public.scans (id, status) values (pg_temp.sid(18), 'failed_qc');

create temp table t_stuck on commit drop as select * from public.list_stuck_qc_scans();

select results_eq('select scan_id, has_active_job from t_stuck',
  $$values (pg_temp.sid(16), true), (pg_temp.sid(11), false), (pg_temp.sid(14), false)$$,
  'default threshold: the stuck scans, oldest first, flagging the one with a wedged job');
select is((select processing_started_at from t_stuck where scan_id = pg_temp.sid(11)),
  now() - interval '20 minutes', 'returns the scan''s processing_started_at');
select ok(not exists (select 1 from t_stuck where scan_id = pg_temp.sid(12)),
  'excluded: active job with an unexpired lease');
select ok(not exists (select 1 from t_stuck where scan_id = pg_temp.sid(13)),
  'excluded: in processing for less than 15 minutes');
select ok(not exists (select 1 from t_stuck where scan_id = pg_temp.sid(15)),
  'excluded: job lease expired but the job was claimed within the threshold');
select ok(not exists (select 1 from t_stuck where scan_id = pg_temp.sid(17)),
  'excluded: job queued in retry backoff');
select ok(not exists (select 1 from t_stuck where scan_id = pg_temp.sid(18)),
  'excluded: scan not in processing');
select ok(exists (select 1 from public.list_stuck_qc_scans(300) where scan_id = pg_temp.sid(13)),
  'a 300 s threshold includes the 6-minute scan');
select ok(not exists (select 1 from public.list_stuck_qc_scans(300) where scan_id = pg_temp.sid(15)),
  'a 300 s threshold still excludes the job claimed a minute ago');
select is((select count(*)::int from public.list_stuck_qc_scans(86400)), 0,
  'nothing has been in processing for a day');
select is((select count(*)::int from public.scans where id = any(array[pg_temp.sid(11), pg_temp.sid(14),
  pg_temp.sid(16)]) and status = 'processing'), 3, 'listing changes no scan status');
select is((select count(*)::int from private.qc_jobs where finished_at is null), 4,
  'listing changes no job');

-- Bounds.
select throws_ok('select * from public.list_stuck_qc_scans(299)', '22023', null, 'threshold below 300 s is rejected');
select throws_ok('select * from public.list_stuck_qc_scans(86401)', '22023', null, 'threshold above 1 day is rejected');
select throws_ok('select * from public.list_stuck_qc_scans(null)', '22023', null, 'null threshold is rejected');
select lives_ok('select * from public.list_stuck_qc_scans(300)', '300 s is allowed');
select lives_ok('select * from public.list_stuck_qc_scans(86400)', '86400 s is allowed');

-- Privileges.
select ok(not has_function_privilege(r, 'public.list_stuck_qc_scans(integer)', 'execute'),
  r || ' cannot execute list_stuck_qc_scans')
from unnest(array['anon', 'authenticated']) as r;
select ok(has_function_privilege('service_role', 'public.list_stuck_qc_scans(integer)', 'execute'),
  'service_role can execute list_stuck_qc_scans');
set local role anon;
select throws_ok('select * from public.list_stuck_qc_scans()', '42501', null, 'anon call is denied');
reset role;
set local role authenticated;
select throws_ok('select * from public.list_stuck_qc_scans()', '42501', null, 'authenticated call is denied');
reset role;
set local role service_role;
select is((select count(*)::int from public.list_stuck_qc_scans()), 3, 'service_role gets the stuck scans');
reset role;

-- Sweep -----------------------------------------------------------------------

select is((select count(*)::int from cron.job where jobname = 'qc-sweep'
  and command = 'select private.qc_sweep()'), 1, 'pg_cron still runs the sweep');
select ok(not has_function_privilege(r, 'private.qc_sweep()', 'execute'), r || ' cannot execute qc_sweep')
from unnest(array['anon', 'authenticated', 'service_role']) as r;

-- No claimable job left, so only stuck scans can trigger the sweep.
update private.qc_jobs set state = 'done', finished_at = now(), lease_until = null, lease_token = null
where finished_at is null;
delete from vault.secrets where name in ('qc_run_url', 'qc_run_secret');
select is(private.qc_sweep(), null, 'stuck scans but no Vault secrets: no-op');
do $$ begin perform vault.create_secret('http://host.docker.internal:3000/api/qc/run', 'qc_run_url'); end $$;
do $$ begin perform vault.create_secret(repeat('s', 40), 'qc_run_secret'); end $$;
create temp table t_req on commit drop as select private.qc_sweep() as id;
select isnt((select id from t_req), null, 'configured, nothing claimable, stuck scans: one request is queued');
select is((select convert_from(body, 'utf8')::jsonb from net.http_request_queue
  where id = (select id from t_req)), '{"source":"sweep"}'::jsonb, 'the request body carries no ids');
update public.scans set status = 'failed_qc' where status = 'processing';
select is(private.qc_sweep(), null, 'configured, nothing claimable, nothing stuck: no request');

-- Limit -------------------------------------------------------------------------

insert into public.scans (id, status) select gen_random_uuid(), 'processing' from generate_series(1, 105);
update public.scans set processing_started_at = now() - interval '1 hour' where status = 'processing';
select is((select count(*)::int from public.list_stuck_qc_scans()), 100, 'at most 100 rows per call');

select * from finish();
rollback;
