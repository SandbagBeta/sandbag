-- Private failure log and report_failure (2026-11-12).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'e1@example.invalid'),
  ('00000000-0000-0000-0000-0000000000e2', 'e2@example.invalid'),
  ('00000000-0000-0000-0000-0000000000e3', 'e3@example.invalid');
insert into public.profiles (id, handle, trust_level) values
  ('00000000-0000-0000-0000-0000000000e1', 'user_e1', 'contributor'),
  ('00000000-0000-0000-0000-0000000000e2', 'user_e2', 'contributor'),
  ('00000000-0000-0000-0000-0000000000e3', 'maint_e3', 'maintainer');

insert into public.failure_logs (reference, stage, code, user_id, detail, context) values
  ('SB-0123ABCD', 'database', 'error', '00000000-0000-0000-0000-0000000000e1', 'boom', '{"holds": 3}');

select has_table('public', 'failure_logs', 'the table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.failure_logs'::regclass), 'row-level security is on');

-- Constraints.
select throws_ok($$insert into public.failure_logs (reference, stage, code) values ('abc', 'database', 'error')$$,
  '23514', null, 'a malformed reference is refused');
select throws_ok($$insert into public.failure_logs (reference, stage, code) values ('SB-0123ABCI', 'database', 'error')$$,
  '23514', null, 'a reference with a letter Crockford leaves out (I) is refused');
select throws_ok($$insert into public.failure_logs (reference, stage, code) values ('SB-0123ABCE', 'nowhere', 'error')$$,
  '23514', null, 'an unknown stage is refused');
select throws_ok($$insert into public.failure_logs (reference, stage, code, context) values ('SB-0123ABCF', 'database', 'error', '[1]')$$,
  '23514', null, 'context must be a json object');
select throws_ok($$insert into public.failure_logs (reference, stage, code) values ('SB-0123ABCD', 'database', 'error')$$,
  '23505', null, 'a reference is unique');

select lives_ok($$insert into public.failure_logs (reference, stage, code) values ('SB-0123ABCH', 'upload', 'scan_create_failed')$$, 'the upload stage is accepted');
select lives_ok($$insert into public.failure_logs (reference, stage, code) values ('SB-0123ABCJ', 'qc', 'pipeline_error')$$, 'the qc stage is accepted');
delete from public.failure_logs where reference in ('SB-0123ABCH', 'SB-0123ABCJ');

-- Access: only maintainers read; nobody but the service role writes.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1"}', true);
select is((select count(*)::int from public.failure_logs), 0, 'the user the failure happened to cannot read the log');
select throws_ok($$insert into public.failure_logs (reference, stage, code) values ('SB-0123ABCG', 'database', 'error')$$,
  '42501', null, 'authenticated users cannot write the log');
select throws_ok($$select public.report_failure('SB-0123ABCD', '00000000-0000-0000-0000-0000000000e1', 'hi')$$,
  '42501', null, 'report_failure is not executable by authenticated users (service role only)');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e3"}', true);
select is((select count(*)::int from public.failure_logs), 1, 'a maintainer can read the log');
reset role;

-- report_failure (as the service role / table owner here).
select is(public.report_failure('SB-0123ABCD', '00000000-0000-0000-0000-0000000000e2', 'not mine'), false,
  'another user cannot report someone else''s failure');
select is(public.report_failure('SB-0123ABCD', '00000000-0000-0000-0000-0000000000e1', '  it broke when saving  '), true,
  'the user the failure happened to can add a note');
select is((select user_note from public.failure_logs where reference = 'SB-0123ABCD'), 'it broke when saving',
  'the trimmed note is stored');
select throws_ok($$select public.report_failure('SB-0123ABCD', '00000000-0000-0000-0000-0000000000e1', '   ')$$,
  '22023', null, 'an empty note is refused');

select * from finish();
rollback;
