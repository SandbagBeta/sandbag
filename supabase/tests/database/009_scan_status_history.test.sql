-- Scan status history, retry_of and qc_report contract (issue #17).
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'a9@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b9', 'b9@example.invalid'),
  ('00000000-0000-0000-0000-0000000000c9', 'c9@example.invalid');
insert into public.profiles (id, handle, trust_level) values
  ('00000000-0000-0000-0000-0000000000a9', 'user_a9', 'contributor'),
  ('00000000-0000-0000-0000-0000000000b9', 'user_b9', 'contributor'),
  ('00000000-0000-0000-0000-0000000000c9', 'rev_c9', 'reviewer');
insert into public.scans (id, uploader_id) values
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a9');

select is((select count(*)::int from public.scan_status_events), 1, 'insert records the first event');
update public.scans set status = 'processing' where id = '90000000-0000-0000-0000-000000000001';
update public.scans set status = 'failed_qc' where id = '90000000-0000-0000-0000-000000000001';
update public.scans set capture_app = 'x' where id = '90000000-0000-0000-0000-000000000001';
select bag_eq($$select from_status::text, to_status::text from public.scan_status_events$$,
  $$values (null, 'uploaded'), ('uploaded', 'processing'), ('processing', 'failed_qc')$$,
  'each status change is recorded once; non-status updates are not');

insert into public.scans (id, uploader_id, retry_of) values
  ('90000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a9', '90000000-0000-0000-0000-000000000001');
select is((select retry_of from public.scans where id = '90000000-0000-0000-0000-000000000002'),
  '90000000-0000-0000-0000-000000000001'::uuid, 'retry_of links to the failed scan');
select throws_ok($$update public.scans set retry_of = id where id = '90000000-0000-0000-0000-000000000002'$$,
  '23514', null, 'a scan cannot retry itself');
select throws_ok($$update public.scans set qc_report = '{"checks": "nope"}' where id = '90000000-0000-0000-0000-000000000002'$$,
  '23514', null, 'qc_report must have a checks array');
select lives_ok($$update public.scans set qc_report = '{"pipeline_version":"1","checks":[]}' where id = '90000000-0000-0000-0000-000000000002'$$,
  'valid qc_report shape accepted');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a9"}', true);
select is((select count(*)::int from public.scan_status_events), 4, 'uploader sees their scans'' timelines');
select throws_ok($$update public.scans set retry_of = null where id = '90000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'uploader cannot write retry_of');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b9"}', true);
select is((select count(*)::int from public.scan_status_events), 0, 'other users see nothing');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c9"}', true);
select is((select count(*)::int from public.scan_status_events), 4, 'reviewers see all timelines');
reset role;

select * from finish();
rollback;
