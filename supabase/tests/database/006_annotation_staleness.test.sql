-- Annotation staleness (issue #26): replacing a scan's mesh flags its climbs;
-- holds must match the scan's current hash; the flag clears once they do.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select has_column('public', 'climbs', 'annotations_stale_at', 'climbs.annotations_stale_at exists');
select ok(not has_column_privilege(r, 'public.climbs', 'annotations_stale_at', p),
  r || ' has no ' || p || ' on climbs.annotations_stale_at')
from unnest(array['anon', 'authenticated']) as r, unnest(array['insert', 'update']) as p;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a6', 'a6@example.invalid');
insert into public.profiles (id, handle, trust_level)
values ('00000000-0000-0000-0000-0000000000a6', 'user_a6', 'contributor');
insert into public.scans (id, uploader_id) values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a6'),
  ('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a6');
insert into public.climbs (id, scan_id, name, proposed_grade, created_by) values
  ('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'A', 'V1', '00000000-0000-0000-0000-0000000000a6'),
  ('61000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 'B', 'V2', '00000000-0000-0000-0000-0000000000a6'),
  ('61000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000002', 'C', 'V3', '00000000-0000-0000-0000-0000000000a6');

-- No hash yet: holds are rejected.
select throws_ok($$insert into public.holds (climb_id, scan_content_hash, position, normal, face_index, type)
  values ('61000000-0000-0000-0000-000000000001', repeat('a', 64), '{0,1,0}', '{0,0,1}', 0, 'start')$$,
  '23514', null, 'holds are rejected while the scan has no mesh hash');

-- First hash flags nothing.
update public.scans set content_hash = repeat('a', 64) where id = '60000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.climbs where annotations_stale_at is not null), 0,
  'setting the first hash flags nothing');

select lives_ok($$insert into public.holds (climb_id, scan_content_hash, position, normal, face_index, type) values
  ('61000000-0000-0000-0000-000000000001', repeat('a', 64), '{0,1,0}', '{0,0,1}', 0, 'start'),
  ('61000000-0000-0000-0000-000000000002', repeat('a', 64), '{0,1,0}', '{0,0,1}', 1, 'start')$$,
  'holds on the current hash are accepted');
select throws_ok($$insert into public.holds (climb_id, scan_content_hash, position, normal, face_index, type)
  values ('61000000-0000-0000-0000-000000000001', repeat('b', 64), '{0,1,0}', '{0,0,1}', 2, 'hand')$$,
  '23514', null, 'holds on another hash are rejected');

-- Replacing the mesh flags every climb of that scan only.
update public.scans set content_hash = repeat('b', 64) where id = '60000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.climbs
  where scan_id = '60000000-0000-0000-0000-000000000001' and annotations_stale_at is not null), 2,
  'mesh replacement flags all climbs of the scan');
select is((select annotations_stale_at from public.climbs where id = '61000000-0000-0000-0000-000000000003'),
  null, 'climbs of other scans are untouched');

-- Re-saving the same hash does not re-flag.
update public.scans set capture_app = 'Polycam' where id = '60000000-0000-0000-0000-000000000002';
select is((select annotations_stale_at from public.climbs where id = '61000000-0000-0000-0000-000000000003'),
  null, 'unrelated scan updates flag nothing');

-- Re-placing holds on the new hash clears the flag only when none are stale.
select lives_ok($$insert into public.holds (climb_id, scan_content_hash, position, normal, face_index, type)
  values ('61000000-0000-0000-0000-000000000001', repeat('b', 64), '{0,1,0}', '{0,0,1}', 5, 'start')$$,
  'new hold on the new hash is accepted');
select isnt((select annotations_stale_at from public.climbs where id = '61000000-0000-0000-0000-000000000001'),
  null, 'flag stays while an old-hash hold remains');
delete from public.holds where climb_id = '61000000-0000-0000-0000-000000000001' and scan_content_hash = repeat('a', 64);
update public.holds set face_index = 6 where climb_id = '61000000-0000-0000-0000-000000000001';
select is((select annotations_stale_at from public.climbs where id = '61000000-0000-0000-0000-000000000001'),
  null, 'flag clears once all holds are on the current hash');
select isnt((select annotations_stale_at from public.climbs where id = '61000000-0000-0000-0000-000000000002'),
  null, 'sibling climb with old holds stays flagged');

select * from finish();
rollback;
