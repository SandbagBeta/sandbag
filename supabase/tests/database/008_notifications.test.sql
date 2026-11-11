-- Notifications (issue #19): one per review of the author's scan/climb, own rows only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a8', 'a8@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b8', 'b8@example.invalid'),
  ('00000000-0000-0000-0000-0000000000c8', 'c8@example.invalid');
insert into public.profiles (id, handle, trust_level) values
  ('00000000-0000-0000-0000-0000000000a8', 'user_a8', 'contributor'),
  ('00000000-0000-0000-0000-0000000000b8', 'user_b8', 'contributor'),
  ('00000000-0000-0000-0000-0000000000c8', 'rev_c8', 'reviewer');
insert into public.scans (id, uploader_id, status) values
  ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a8', 'pending_review'),
  ('80000000-0000-0000-0000-000000000002', null, 'pending_review');
insert into public.climbs (id, scan_id, name, proposed_grade, created_by) values
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 'Mine', 'V3', '00000000-0000-0000-0000-0000000000b8');

insert into public.reviews (subject_type, subject_id, reviewer_id, verdict, reason) values
  ('scan', '80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c8', 'request_changes', 'Retake the top'),
  ('climb', '81000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c8', 'approve', null),
  ('scan', '80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c8', 'reject', 'Blurry'),
  ('area', gen_random_uuid(), '00000000-0000-0000-0000-0000000000c8', 'approve', null);

select is((select count(*)::int from public.notifications), 2,
  'one notification per reviewed scan/climb; none for anonymized or area subjects');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a8"}', true);
select is((select count(*)::int from public.notifications), 1, 'scan author sees only their own');
select is((select count(*)::int from public.notifications where read_at is null), 1, 'starts unread');
select lives_ok($$update public.notifications set read_at = now()$$, 'author can mark read');
select is((select count(*)::int from public.notifications where read_at is not null), 1, 'read_at stored');
select throws_ok($$update public.notifications set user_id = '00000000-0000-0000-0000-0000000000b8'$$,
  '42501', null, 'user_id is not writable');
select throws_ok($$insert into public.notifications (user_id, review_id)
  select user_id, review_id from public.notifications$$, '42501', null, 'users cannot insert');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b8"}', true);
select is((select count(*)::int from public.notifications), 1, 'climb author sees only theirs');
reset role;

set local role anon;
select is_empty($$select * from public.notifications$$, 'anon sees nothing');
reset role;

select * from finish();
rollback;
