-- Storage `uploads` policy: owners may insert and read their own raw files
-- while the scan is `uploaded`, but never update or delete them (ADR 002 §3).
-- User A owns scan SU (uploaded); user B is another contributor.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.invalid'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@example.invalid');
insert into public.profiles (id, handle) values
  ('00000000-0000-0000-0000-0000000000a1', 'store_a'),
  ('00000000-0000-0000-0000-0000000000b1', 'store_b');
insert into public.scans (id, uploader_id, status) values
  ('20000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'uploaded');
insert into storage.buckets (id, name, public) values ('uploads', 'uploads', false)
on conflict (id) do nothing;

-- Policy shape: only insert and select exist for contributors.
select policies_are('storage', 'objects',
  array['uploads_own_raw_insert', 'uploads_own_raw_select'],
  'storage.objects has only the insert and select upload policies');
select policy_cmd_is('storage', 'objects', 'uploads_own_raw_insert', 'insert',
  'upload policy allows insert');
select policy_cmd_is('storage', 'objects', 'uploads_own_raw_select', 'select',
  'read policy allows select');

-- The Storage API sets this flag before deleting; set it so the delete below
-- is decided by RLS, not by Supabase's direct-delete guard.
select set_config('storage.allow_delete_query', 'true', true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
select lives_ok($$insert into storage.objects (bucket_id, name) values
  ('uploads', '00000000-0000-0000-0000-0000000000a1/20000000-0000-0000-0000-0000000000a1/raw/x.glb')$$,
  'owner uploads a raw file while uploaded');
select is((select count(*)::int from storage.objects where bucket_id = 'uploads'), 1,
  'owner reads own raw file while uploaded');
select is_empty($$delete from storage.objects
  where bucket_id = 'uploads' and name like '%/raw/x.glb' returning id$$,
  'owner cannot delete own raw file');
select is_empty($$update storage.objects set metadata = '{"swapped":true}'
  where bucket_id = 'uploads' and name like '%/raw/x.glb' returning id$$,
  'owner cannot overwrite own raw file');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'uploads'), 0,
  'another contributor cannot read the owner''s raw file');
reset role;

select is((select count(*)::int from storage.objects
  where bucket_id = 'uploads' and name like '%/raw/x.glb' and metadata is null), 1,
  'the raw file is still there, unmodified');

select * from finish();
rollback;
