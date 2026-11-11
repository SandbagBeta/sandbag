-- Freetext attach note (issue #28): private to uploader + reviewers, no coordinates.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000aa', 'aa@example.invalid'),
  ('00000000-0000-0000-0000-0000000000ba', 'ba@example.invalid'),
  ('00000000-0000-0000-0000-0000000000ca', 'ca@example.invalid');
insert into public.profiles (id, handle, trust_level) values
  ('00000000-0000-0000-0000-0000000000aa', 'user_aa', 'contributor'),
  ('00000000-0000-0000-0000-0000000000ba', 'user_ba', 'contributor'),
  ('00000000-0000-0000-0000-0000000000ca', 'rev_ca', 'reviewer');
insert into public.scans (id, uploader_id, status) values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', 'uploaded'),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000aa', 'pending_review');
update public.scans set status = 'processing' where id = 'a0000000-0000-0000-0000-000000000002';
update public.scans set status = 'pending_review' where id = 'a0000000-0000-0000-0000-000000000002';

select throws_ok($$insert into public.scan_attach_notes (scan_id, note) values ('a0000000-0000-0000-0000-000000000001', '41.12345, -74.54321')$$,
  '23514', null, 'a coordinate pair is refused');
select throws_ok($$insert into public.scan_attach_notes (scan_id, note) values ('a0000000-0000-0000-0000-000000000001', '   ')$$,
  '23514', null, 'blank note refused');
select throws_ok($$insert into public.scan_attach_notes (scan_id, note) values ('a0000000-0000-0000-0000-000000000001', repeat('x', 501))$$,
  '23514', null, 'over 500 characters refused');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa"}', true);
select lives_ok($$insert into public.scan_attach_notes (scan_id, note) values ('a0000000-0000-0000-0000-000000000001', 'Big boulder past the second stream, not in OpenBeta')$$,
  'uploader adds a note');
select lives_ok($$update public.scan_attach_notes set note = 'Big boulder past the second stream' where scan_id = 'a0000000-0000-0000-0000-000000000001'$$,
  'uploader edits it');
select is((select count(*)::int from public.scan_attach_notes), 1, 'uploader reads it');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ba"}', true);
select is((select count(*)::int from public.scan_attach_notes), 0, 'another user cannot read it');
select throws_ok($$insert into public.scan_attach_notes (scan_id, note) values ('a0000000-0000-0000-0000-000000000002', 'hi')$$,
  '42501', null, 'another user cannot write one');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ca"}', true);
select is((select count(*)::int from public.scan_attach_notes), 1, 'reviewer reads it');
reset role;

set local role anon;
select throws_ok($$select * from public.scan_attach_notes$$, '42501', null, 'anon has no access');
reset role;

select * from finish();
rollback;
