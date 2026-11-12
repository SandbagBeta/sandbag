-- create_climb_annotations / replace_climb_annotations (issue #22, A and E).
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000af', 'af@example.invalid'),
  ('00000000-0000-0000-0000-0000000000bf', 'bf@example.invalid');
insert into public.profiles (id, handle) values
  ('00000000-0000-0000-0000-0000000000af', 'user_af'),
  ('00000000-0000-0000-0000-0000000000bf', 'user_bf');
insert into public.scans (id, uploader_id, status, glb_path, content_hash) values
  ('f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000af', 'published', 'p/f.glb', repeat('f', 64)),
  ('f0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000af', 'uploaded', null, null);

create temp table t (climb uuid);
grant all on t to public;

-- Payloads: n holds (the first `starts` are start holds), a line and a topout.
create function pg_temp.holds(n int default 3, starts int default 1) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
    'position', jsonb_build_array(i, 0, 0), 'normal', jsonb_build_array(0, 0, 1),
    'face_index', i, 'type', case when i <= starts then 'start' else 'hand' end, 'seq_order', i))
  from generate_series(1, n) i
$$;
create function pg_temp.paths() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('kind', 'line', 'points', jsonb_build_array(jsonb_build_array(0,0,0), jsonb_build_array(1,1,1))),
    jsonb_build_object('kind', 'topout', 'points', jsonb_build_array(jsonb_build_array(1,1,1), jsonb_build_array(1,2,1))))
$$;

select has_function('public', 'create_climb_annotations', 'create function exists');
select has_function('public', 'replace_climb_annotations', 'replace function exists');

insert into t select public.create_climb_annotations(
  '00000000-0000-0000-0000-0000000000af', 'f0000000-0000-0000-0000-000000000001', repeat('f', 64),
  'Slab', 'desc', 'V3', null, pg_temp.holds(), pg_temp.paths());
select is((select count(*)::int from public.holds where climb_id = (select climb from t)), 3, 'create writes the holds');
select is((select count(*)::int from public.paths where climb_id = (select climb from t)), 2, 'create writes the paths');
select is((select scan_content_hash from public.holds where climb_id = (select climb from t) limit 1),
  repeat('f', 64), 'holds take the hash from the argument');
select is((select status::text from public.climbs where id = (select climb from t)), 'pending_review', 'new climb is pending_review');

select throws_ok($$select public.create_climb_annotations('00000000-0000-0000-0000-0000000000af', 'f0000000-0000-0000-0000-000000000001', repeat('f', 64), 'slab ', '', 'V3', null, pg_temp.holds(), pg_temp.paths())$$,
  '23505', null, 'duplicate name refused (23505)');
select throws_ok($$select public.create_climb_annotations('00000000-0000-0000-0000-0000000000af', 'f0000000-0000-0000-0000-000000000001', repeat('e', 64), 'Other', '', 'V3', null, pg_temp.holds(), pg_temp.paths())$$,
  '23514', null, 'stale mesh hash refused');
select throws_ok($$select public.create_climb_annotations('00000000-0000-0000-0000-0000000000af', 'f0000000-0000-0000-0000-000000000002', repeat('f', 64), 'Other', '', 'V3', null, pg_temp.holds(), pg_temp.paths())$$,
  '23514', null, 'unpublished scan refused');
select throws_ok($$select public.create_climb_annotations('00000000-0000-0000-0000-0000000000af', 'f0000000-0000-0000-0000-000000000001', repeat('f', 64), 'Few', '', 'V3', null, pg_temp.holds(2), pg_temp.paths())$$,
  '23514', null, 'fewer than 3 holds refused');
select throws_ok($$select public.create_climb_annotations('00000000-0000-0000-0000-0000000000af', 'f0000000-0000-0000-0000-000000000001', repeat('f', 64), 'Starts', '', 'V3', null, pg_temp.holds(5, 3), pg_temp.paths())$$,
  '23514', null, 'more than 2 start holds refused');
select is((select count(*)::int from public.climbs where scan_id = 'f0000000-0000-0000-0000-000000000001'), 1,
  'failed creates leave no climb behind (atomic)');

-- Edit: replace holds and paths on own pending climb; others cannot.
select lives_ok($$select public.replace_climb_annotations('00000000-0000-0000-0000-0000000000af', (select climb from t), repeat('f', 64), pg_temp.holds(4), '[]'::jsonb)$$,
  'owner replaces holds and paths');
select is((select count(*)::int from public.holds where climb_id = (select climb from t)), 4, 'replace swaps the holds');
select throws_ok($$select public.replace_climb_annotations('00000000-0000-0000-0000-0000000000bf', (select climb from t), repeat('f', 64), pg_temp.holds(), '[]'::jsonb)$$,
  '42501', null, 'another user cannot replace');

-- A mesh swap flags the climb stale (#26); replacing holds on the new hash clears it.
update public.scans set content_hash = repeat('9', 64) where id = 'f0000000-0000-0000-0000-000000000001';
select isnt((select annotations_stale_at from public.climbs where id = (select climb from t)), null, 'mesh swap flags the climb stale');
select public.replace_climb_annotations('00000000-0000-0000-0000-0000000000af', (select climb from t), repeat('9', 64), pg_temp.holds(), pg_temp.paths());
select is((select annotations_stale_at from public.climbs where id = (select climb from t)), null, 're-placing holds on the new hash clears the stale flag');

-- Closed doors: no direct climb insert for API roles.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000af"}', true);
select throws_ok($$insert into public.climbs (scan_id, name, proposed_grade, created_by) values ('f0000000-0000-0000-0000-000000000001', 'Direct', 'V1', '00000000-0000-0000-0000-0000000000af')$$,
  '42501', null, 'authenticated cannot insert climbs directly');
select throws_ok($$select public.create_climb_annotations('00000000-0000-0000-0000-0000000000af', 'f0000000-0000-0000-0000-000000000001', repeat('f', 64), 'Rpc', '', 'V3', null, pg_temp.holds(), pg_temp.paths())$$,
  '42501', null, 'authenticated cannot execute the RPC (service_role only)');
reset role;

select * from finish();
rollback;
