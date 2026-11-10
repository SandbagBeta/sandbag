-- RLS: allowed and denied cases per role (issue #3, PR 2). Fixture ids:
-- users A (contributor, owns everything), B (other contributor), R (reviewer),
-- M (maintainer). Scan SP is published, SU is uploaded. Climb CP is
-- published, CQ pending; both are on SP.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.invalid'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.invalid'),
  ('00000000-0000-0000-0000-00000000000c', 'r@example.invalid'),
  ('00000000-0000-0000-0000-00000000000d', 'm@example.invalid');
insert into public.profiles (id, handle, trust_level) values
  ('00000000-0000-0000-0000-00000000000a', 'user_a', 'contributor'),
  ('00000000-0000-0000-0000-00000000000b', 'user_b', 'contributor'),
  ('00000000-0000-0000-0000-00000000000c', 'user_r', 'reviewer'),
  ('00000000-0000-0000-0000-00000000000d', 'user_m', 'maintainer');
insert into public.area_cache (openbeta_area_id, name, path_tokens, ancestors, fetched_at, refresh_after)
values ('10000000-0000-0000-0000-000000000001', 'Test Area', '{USA,Test Area}', '{}', now(), now());
insert into public.area_cache_coords (openbeta_area_id, lat, lng)
values ('10000000-0000-0000-0000-000000000001', 42.0, -71.0);
insert into public.area_privacy (openbeta_area_id, location_privacy, reason, set_by)
values ('10000000-0000-0000-0000-000000000001', 'hidden', 'test', '00000000-0000-0000-0000-00000000000d');
insert into public.scans (id, uploader_id, status, glb_path, content_hash) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
   'published', 'sp/x.glb', repeat('a', 64)),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
   'uploaded', null, null),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000c',
   'uploaded', null, null);
insert into public.climbs (id, scan_id, name, proposed_grade, status, created_by) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'Published', 'V3', 'published', '00000000-0000-0000-0000-00000000000a'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
   'Pending', 'V4', 'pending_review', '00000000-0000-0000-0000-00000000000a');
insert into public.holds (climb_id, scan_content_hash, position, normal, face_index, type) values
  ('30000000-0000-0000-0000-000000000001', repeat('a', 64), '{0,1,0}', '{0,0,1}', 0, 'start'),
  ('30000000-0000-0000-0000-000000000002', repeat('a', 64), '{0,1,0}', '{0,0,1}', 1, 'start');
insert into public.grade_votes (climb_id, user_id, grade)
values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'V3');
insert into public.reviews (subject_type, subject_id, reviewer_id, verdict, reason)
values ('scan', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c',
        'request_changes', 'needs a ground plane');
insert into storage.buckets (id, name, public) values
  ('uploads', 'uploads', false), ('published', 'published', true)
on conflict (id) do nothing;

-- anon ---------------------------------------------------------------------
set local role anon;
select is((select count(*)::int from public.area_cache), 1, 'anon reads area names');
select throws_ok('select * from public.area_cache_coords', '42501', null, 'anon cannot read area coords');
select is((select count(*)::int from public.area_privacy), 0, 'anon cannot read privacy flags');
select is((select count(*)::int from public.scans), 1, 'anon sees only published scans');
select is((select count(*)::int from public.climbs), 1, 'anon sees only published climbs');
select is((select count(*)::int from public.holds), 1, 'anon sees holds of published climbs only');
select is((select count(*)::int from public.grade_votes), 0, 'anon sees no individual votes');
select is((select count(*)::int from public.reviews), 0, 'anon sees no reviews');
select throws_ok($$insert into public.profiles (id, handle) values (gen_random_uuid(), 'anon_x')$$,
  '42501', null, 'anon cannot write');
reset role;

-- B: another contributor ---------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b"}', true);
select is((select count(*)::int from public.scans where id = '20000000-0000-0000-0000-000000000002'),
  0, 'B cannot see A''s unpublished scan');
select throws_ok('select * from public.climb_cache_coords', '42501', null, 'B cannot read climb coords');
select throws_ok($$insert into public.scans (uploader_id) values ('00000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'B cannot create a scan as A');
select is_empty($$update public.scans set capture_app = 'x'
  where id = '20000000-0000-0000-0000-000000000002' returning id$$, 'B cannot edit A''s scan');
select throws_ok($$insert into storage.objects (bucket_id, name) values
  ('uploads', '00000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000002/raw/x.glb')$$,
  '42501', null, 'B cannot upload into A''s prefix');
select throws_ok($$insert into public.reviews (subject_type, subject_id, reviewer_id, verdict)
  values ('scan', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'approve')$$,
  '42501', null, 'contributors cannot review');
select throws_ok($$insert into public.area_privacy (openbeta_area_id, location_privacy, reason, set_by)
  values (gen_random_uuid(), 'exact', 'x', '00000000-0000-0000-0000-00000000000b')$$,
  '42501', null, 'contributors cannot set privacy');
select throws_ok($$insert into public.grade_votes (climb_id, user_id, grade)
  values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'V9')$$,
  '42501', null, 'B cannot vote as A');
select lives_ok($$insert into public.grade_votes (climb_id, user_id, grade)
  values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'V4')$$,
  'B votes on a published climb');
select throws_ok($$insert into public.grade_votes (climb_id, user_id, grade)
  values ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b', 'V4')$$,
  '42501', null, 'no votes on unpublished climbs');
select throws_ok($$insert into public.holds (climb_id, scan_content_hash, position, normal, face_index, type)
  values ('30000000-0000-0000-0000-000000000002', repeat('a', 64), '{1,1,0}', '{0,0,1}', 3, 'foot')$$,
  '42501', null, 'B cannot add holds to A''s pending climb');
select throws_ok($$insert into public.profiles (id, handle, trust_level)
  values ('00000000-0000-0000-0000-00000000000b', 'user_b2', 'maintainer')$$,
  '42501', null, 'a contributor cannot set trust_level on insert');

-- A: owner -------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', true);
select is((select count(*)::int from public.scans), 2, 'A sees own unpublished scan');
select throws_ok($$update public.scans set status = 'published'
  where id = '20000000-0000-0000-0000-000000000002'$$, '42501', null, 'A cannot write status');
select throws_ok($$insert into public.scans (uploader_id, status)
  values ('00000000-0000-0000-0000-00000000000a', 'published')$$,
  '42501', null, 'A cannot create a scan already published');
select throws_ok($$update public.profiles set trust_level = 'maintainer'
  where id = '00000000-0000-0000-0000-00000000000a'$$, '42501', null, 'A cannot raise own trust');
select lives_ok($$insert into storage.objects (bucket_id, name) values
  ('uploads', '00000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000002/raw/x.glb')$$,
  'A uploads raw into own prefix while uploaded');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('published', 'x/y.glb')$$,
  '42501', null, 'A cannot write the published bucket');
select is_empty($$update public.holds set face_index = 9
  where climb_id = '30000000-0000-0000-0000-000000000001' returning id$$,
  'published holds are immutable to their author');
select lives_ok($$insert into public.holds (climb_id, scan_content_hash, position, normal, face_index, type)
  values ('30000000-0000-0000-0000-000000000002', repeat('a', 64), '{1,1,0}', '{0,0,1}', 2, 'hand')$$,
  'A adds holds to own pending climb');
select is((select count(*)::int from public.reviews), 1, 'A reads reviews of own scan');

-- R: reviewer ----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c"}', true);
select is((select count(*)::int from public.scans), 3, 'reviewer sees the queue');
select lives_ok($$insert into public.reviews (subject_type, subject_id, reviewer_id, verdict)
  values ('scan', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000c', 'approve')$$,
  'reviewer can review');
select throws_ok($$update public.reviews set verdict = 'reject'$$, '42501', null, 'reviews are append-only');
select throws_ok($$insert into public.reviews (subject_type, subject_id, reviewer_id, verdict)
  values ('scan', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000d', 'approve')$$,
  '42501', null, 'a reviewer cannot review as someone else');
select throws_ok($$insert into public.reviews (subject_type, subject_id, reviewer_id, verdict)
  values ('scan', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000c', 'approve')$$,
  '42501', null, 'a reviewer cannot review their own scan');
select throws_ok('select * from public.area_cache_coords', '42501', null, 'reviewer cannot read coords');

-- M: maintainer --------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d"}', true);
select is((select count(*)::int from public.area_privacy), 1, 'maintainer reads privacy flags');
select lives_ok($$insert into public.area_privacy (openbeta_area_id, location_privacy, reason, set_by)
  values (gen_random_uuid(), 'fuzzed_1km', 'test', '00000000-0000-0000-0000-00000000000d')$$,
  'maintainer sets a privacy flag');
select throws_ok('select * from public.climb_cache_coords', '42501', null, 'maintainer cannot read coords');
reset role;

-- Takedown: unpublishing a scan hides everything annotated on it ------------
update public.scans set status = 'rejected' where id = '20000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', '', true); -- anon requests carry no user
set local role anon;
select is((select count(*)::int from public.climbs), 0, 'takedown hides the scan''s climbs');
select is((select count(*)::int from public.holds), 0, 'takedown hides the scan''s holds');
reset role;

-- Upload rights end when the scan leaves `uploaded`.
update public.scans set status = 'processing' where id = '20000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a"}', true);
select throws_ok($$insert into storage.objects (bucket_id, name) values
  ('uploads', '00000000-0000-0000-0000-00000000000a/20000000-0000-0000-0000-000000000002/raw/y.glb')$$,
  '42501', null, 'no uploads once the scan is processing');
reset role;

select * from finish();
rollback;
