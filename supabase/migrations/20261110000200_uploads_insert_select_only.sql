-- Narrow the `uploads` storage policy to insert + select (ADR 002 §3).
--
-- 20261110000100 created `uploads_own_raw` as `for all`, which also let an
-- owner UPDATE (overwrite) and DELETE their raw file while the scan is
-- `uploaded`. ADR 002 grants contributors "insert/read own prefix only". A
-- deleted or swapped raw file leaves the scan row pointing at bytes that no
-- longer match what was uploaded, and the QC pipeline (#16) would pick up
-- whatever is there. Withdrawal goes through deleting the scan row instead;
-- object cleanup is server-side under ADR 002's retention policy.
--
-- The conditions are unchanged: own `{uploader_id}/` prefix, `raw/` segment,
-- and only while the owner's scan is `uploaded`. If #15's resumable uploads
-- need UPDATE (e.g. TUS upsert), add a narrow policy there, with a test.

drop policy uploads_own_raw on storage.objects;

create policy uploads_own_raw_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[3] = 'raw'
    and exists (select 1 from public.scans s
      where s.id::text = (storage.foldername(name))[2]
        and s.uploader_id = (select auth.uid()) and s.status = 'uploaded')
  );

create policy uploads_own_raw_select on storage.objects for select to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[3] = 'raw'
    and exists (select 1 from public.scans s
      where s.id::text = (storage.foldername(name))[2]
        and s.uploader_id = (select auth.uid()) and s.status = 'uploaded')
  );
