-- Schema v1 shape and security defaults (issue #3, PR 1). Runs with
-- `supabase test db` (pgTAP). PR 2 adds policy tests that act as each role.
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

select has_table('public', t, 'table ' || t || ' exists')
from unnest(array[
  'profiles', 'area_cache', 'area_cache_coords', 'climb_cache',
  'climb_cache_coords', 'area_privacy', 'scans', 'climbs', 'holds', 'paths',
  'grade_votes', 'reviews'
]) as t;

-- Deny by default: no public table may ship without RLS.
select is(
  (select count(*)::int from pg_tables
   where schemaname = 'public' and not rowsecurity),
  0,
  'RLS is enabled on every public table'
);

-- Raw coordinates are unreachable by the public API roles (ADR 001 flag 5).
select ok(
  not has_table_privilege(r, 'public.' || t, p),
  r || ' has no ' || p || ' on ' || t
)
from unnest(array['anon', 'authenticated']) as r,
     unnest(array['area_cache_coords', 'climb_cache_coords']) as t,
     unnest(array['select']) as p;

-- Coordinates exist nowhere else in the public schema.
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public'
     and column_name in ('lat', 'lng', 'bbox', 'latitude', 'longitude')
     and table_name not like '%\_coords'),
  0,
  'geo columns only appear in *_coords tables'
);

-- No OpenBeta prose or location text is cached (ADR 001 flag 9).
select hasnt_column('public', 'area_cache', 'description',
  'area_cache stores no OpenBeta description');

-- A published scan must point at a canonical mesh.
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000a1', 'schema-test@example.invalid');
insert into public.profiles (id, handle)
values ('00000000-0000-0000-0000-0000000000a1', 'schema_test');
select throws_ok(
  $$insert into public.scans (uploader_id, status)
    values ('00000000-0000-0000-0000-0000000000a1', 'published')$$,
  '23514',
  null,
  'a published scan without glb_path/content_hash is rejected'
);

select * from finish();
rollback;
