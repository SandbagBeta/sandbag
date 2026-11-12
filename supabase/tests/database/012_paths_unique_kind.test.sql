-- One path per kind per climb (issue #22, D).
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ad', 'ad@example.invalid');
insert into public.profiles (id, handle) values ('00000000-0000-0000-0000-0000000000ad', 'user_ad');
insert into public.scans (id, uploader_id, status, glb_path, content_hash) values
  ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000ad', 'published', 'p/d.glb', repeat('d', 64));
insert into public.climbs (id, scan_id, name, proposed_grade) values
  ('d1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'A', 'V1'),
  ('d1000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'B', 'V1');
insert into public.paths (climb_id, kind, points) values
  ('d1000000-0000-0000-0000-000000000001', 'topout', '[[0,0,0],[0,1,0]]');

select throws_ok($$insert into public.paths (climb_id, kind, points) values ('d1000000-0000-0000-0000-000000000001', 'topout', '[[1,1,1],[1,2,1]]')$$,
  '23505', null, 'a second topout on the same climb is refused');
select lives_ok($$insert into public.paths (climb_id, kind, points) values ('d1000000-0000-0000-0000-000000000001', 'line', '[[0,0,0],[0,1,0]]')$$,
  'a different kind on the same climb is fine');
select lives_ok($$insert into public.paths (climb_id, kind, points) values ('d1000000-0000-0000-0000-000000000002', 'topout', '[[0,0,0],[0,1,0]]')$$,
  'the same kind on another climb is fine');

select * from finish();
rollback;
