-- One climb name per scan, normalised like the validator (issue #23).
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ab', 'ab@example.invalid');
insert into public.profiles (id, handle) values ('00000000-0000-0000-0000-0000000000ab', 'user_ab');
insert into public.scans (id, uploader_id, status, glb_path, content_hash) values
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000ab', 'published', 'p/a.glb', repeat('a', 64)),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000ab', 'published', 'p/b.glb', repeat('b', 64));
insert into public.climbs (scan_id, name, proposed_grade) values
  ('b0000000-0000-0000-0000-000000000001', 'The  Slab', 'V2');

select throws_ok($$insert into public.climbs (scan_id, name, proposed_grade) values ('b0000000-0000-0000-0000-000000000001', 'the slab', 'V3')$$,
  '23505', null, 'case-insensitive duplicate refused');
select throws_ok($$insert into public.climbs (scan_id, name, proposed_grade) values ('b0000000-0000-0000-0000-000000000001', '  THE slab ', 'V3')$$,
  '23505', null, 'whitespace differences are ignored');
select lives_ok($$insert into public.climbs (scan_id, name, proposed_grade) values ('b0000000-0000-0000-0000-000000000002', 'The Slab', 'V3')$$,
  'same name on another scan is fine');
select lives_ok($$insert into public.climbs (scan_id, name, proposed_grade) values ('b0000000-0000-0000-0000-000000000001', 'The Slab Left', 'V3')$$,
  'a different name is fine');
select throws_ok($$insert into public.climbs (scan_id, name, proposed_grade, status) values ('b0000000-0000-0000-0000-000000000001', 'the slab', 'V3', 'rejected')$$,
  '23505', null, 'any status counts, like the validator');

select * from finish();
rollback;
