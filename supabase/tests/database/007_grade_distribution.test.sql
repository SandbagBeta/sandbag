-- climb_grade_distribution (issue #24): aggregates only, published only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select has_function('public', 'climb_grade_distribution', array['uuid'], 'function exists');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'a7@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b7', 'b7@example.invalid'),
  ('00000000-0000-0000-0000-0000000000c7', 'c7@example.invalid');
insert into public.profiles (id, handle, trust_level) values
  ('00000000-0000-0000-0000-0000000000a7', 'user_a7', 'contributor'),
  ('00000000-0000-0000-0000-0000000000b7', 'user_b7', 'contributor'),
  ('00000000-0000-0000-0000-0000000000c7', 'user_c7', 'contributor');
insert into public.scans (id, uploader_id, status, glb_path, content_hash)
values ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a7',
        'published', 'sp/x.glb', repeat('a', 64));
insert into public.climbs (id, scan_id, name, proposed_grade, status, created_by) values
  ('71000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'Pub', 'V3', 'published', '00000000-0000-0000-0000-0000000000a7'),
  ('71000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'Pend', 'V4', 'pending_review', '00000000-0000-0000-0000-0000000000a7');
insert into public.grade_votes (climb_id, user_id, grade) values
  ('71000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a7', 'V4'),
  ('71000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b7', 'V4'),
  ('71000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c7', 'V5'),
  ('71000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a7', 'V4');

set local role anon;
select results_eq($$select grade, votes from public.climb_grade_distribution('71000000-0000-0000-0000-000000000001')$$,
  $$values ('V4', 2), ('V5', 1)$$, 'anon sees counts per grade for a published climb');
select is_empty($$select * from public.climb_grade_distribution('71000000-0000-0000-0000-000000000002')$$,
  'unpublished climb returns no rows');
select is_empty($$select * from public.climb_grade_distribution(gen_random_uuid())$$,
  'unknown climb returns no rows');
select throws_ok($$select * from public.grade_votes$$, '42501', null, 'anon still cannot read raw votes');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c7"}', true);
select results_eq($$select grade, votes from public.climb_grade_distribution('71000000-0000-0000-0000-000000000001')$$,
  $$values ('V4', 2), ('V5', 1)$$, 'authenticated sees the full distribution, not just their own vote');
reset role;

select * from finish();
rollback;
