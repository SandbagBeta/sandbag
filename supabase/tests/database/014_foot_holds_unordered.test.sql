-- Foot holds are unordered, optional, per climb, and not counted (2026-11-12).
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'f1@example.invalid');
insert into public.profiles (id, handle) values ('00000000-0000-0000-0000-0000000000f1', 'user_f1');
insert into public.scans (id, uploader_id, status, glb_path, content_hash) values
  ('f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'published', 'p/f1.glb', repeat('1', 64));

-- n non-foot holds (first is a start, seq 0..n-1) plus f feet (seq_order null,
-- or `foot_seq` when given, to test the rejection).
create function pg_temp.holds(n int, f int default 0, foot_seq int default null) returns jsonb language sql as $$
  select coalesce(jsonb_agg(h order by ord), '[]'::jsonb) from (
    select i as ord, jsonb_build_object(
      'position', jsonb_build_array(i, 0, 0), 'normal', jsonb_build_array(0, 0, 1),
      'face_index', i, 'type', case when i = 1 then 'start' else 'hand' end, 'seq_order', i - 1) as h
      from generate_series(1, n) i
    union all
    select 1000 + j, jsonb_build_object(
      'position', jsonb_build_array(j, 5, 0), 'normal', jsonb_build_array(0, 0, 1),
      'face_index', 100 + j, 'type', 'foot', 'seq_order', foot_seq)
      from generate_series(1, f) j
  ) x
$$;

create temp table t (a uuid, b uuid);
grant all on t to public;

-- Feet are not counted toward the minimum.
select throws_ok($$select public.create_climb_annotations('00000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-000000000001', repeat('1', 64), 'OnlyFeet', '', 'V1', null, pg_temp.holds(2, 3), '[]'::jsonb)$$,
  '23514', null, '2 holds plus 3 feet is still too few (feet are not counted)');

-- Feet are optional: 3 non-foot holds and no feet is fine.
insert into t (a) values (public.create_climb_annotations('00000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-000000000001', repeat('1', 64), 'NoFeet', '', 'V1', null, pg_temp.holds(3, 0), '[]'::jsonb));
select is((select count(*)::int from public.holds where climb_id = (select a from t) and type = 'foot'), 0, 'a climb without feet is valid');

-- With feet: stored unordered, as single points of this climb.
update t set b = public.create_climb_annotations('00000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-000000000001', repeat('1', 64), 'WithFeet', '', 'V1', null, pg_temp.holds(3, 2), '[]'::jsonb);
select is((select count(*)::int from public.holds where climb_id = (select b from t) and type = 'foot'), 2, 'feet are stored with the climb');
select is((select count(*)::int from public.holds where climb_id = (select b from t) and type = 'foot' and seq_order is null), 2, 'feet have no sequence number');
select results_eq($$select seq_order from public.holds where climb_id = (select b from t) and type <> 'foot' order by seq_order$$,
  $$values (0), (1), (2)$$, 'the other holds keep a contiguous sequence');

-- A foot with a sequence number is refused, by the function and by the table.
select throws_ok($$select public.create_climb_annotations('00000000-0000-0000-0000-0000000000f1', 'f1000000-0000-0000-0000-000000000001', repeat('1', 64), 'SeqFoot', '', 'V1', null, pg_temp.holds(3, 1, 7), '[]'::jsonb)$$,
  '23514', null, 'a foot hold with a sequence number is refused by the function');
select throws_ok($$insert into public.holds (climb_id, scan_content_hash, position, normal, face_index, type, seq_order) values ((select b from t), repeat('1', 64), '{1,1,1}', '{0,0,1}', 5, 'foot', 4)$$,
  '23514', null, 'and by the table constraint');

-- Feet belong to one climb: another climb on the same rock has its own, even at the same spot.
insert into public.climbs (id, scan_id, name, proposed_grade, created_by) values
  ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'Neighbour', 'V2', '00000000-0000-0000-0000-0000000000f1');
insert into public.holds (climb_id, scan_content_hash, position, normal, face_index, type) values
  ('f2000000-0000-0000-0000-000000000001', repeat('1', 64), '{1,5,0}', '{0,0,1}', 101, 'foot');
select is((select count(*)::int from public.holds where climb_id = (select b from t) and type = 'foot'), 2, 'the neighbour climb''s foot does not touch this climb''s feet');
select is((select count(*)::int from public.holds where climb_id = 'f2000000-0000-0000-0000-000000000001' and type = 'foot'), 1, 'each climb keeps its own feet');

-- Replace keeps the rules: swaps the feet.
select lives_ok($$select public.replace_climb_annotations('00000000-0000-0000-0000-0000000000f1', (select b from t), repeat('1', 64), pg_temp.holds(3, 1), '[]'::jsonb)$$,
  'replace swaps the feet and keeps the rules');
select is((select count(*)::int from public.holds where climb_id = (select b from t) and type = 'foot'), 1, 'replace left exactly the new feet');

select * from finish();
rollback;
