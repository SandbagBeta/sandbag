-- RLS policies (issue #3, PR 2 of 2). PRD §8: contributors edit their own
-- pending items; published items are immutable except through review; grade
-- votes are per-user. Status, paths, hashes and trust levels are written only
-- server-side (service role: lifecycle module #20, QC pipeline #16).

-- Helpers live in a schema PostgREST doesn't expose.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create function private.has_trust(minimum public.trust_level)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select p.trust_level >= minimum from public.profiles p
     where p.id = (select auth.uid())),
    false)
$$;
revoke all on function private.has_trust from public;
grant execute on function private.has_trust to anon, authenticated;

-- Table privileges: anon never writes. Writes by authenticated are narrowed to
-- the columns a contributor may set; everything else is service-role only.
revoke insert, update, delete, truncate on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
-- Future tables start write-locked too; each migration grants what it needs.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate on tables from anon, authenticated;

grant insert (id, handle) on public.profiles to authenticated;
grant update (handle) on public.profiles to authenticated;
grant insert (uploader_id, openbeta_area_id, openbeta_climb_id, capture_app, captured_at)
  on public.scans to authenticated;
grant update (openbeta_area_id, openbeta_climb_id, capture_app, captured_at)
  on public.scans to authenticated;
grant delete on public.scans to authenticated;
grant insert (scan_id, name, description, proposed_grade, fa_info, created_by)
  on public.climbs to authenticated;
grant update (name, description, proposed_grade, fa_info) on public.climbs to authenticated;
grant delete on public.climbs to authenticated;
grant insert, update, delete on public.holds, public.paths to authenticated;
grant insert, update (grade), delete on public.grade_votes to authenticated;
grant insert (subject_type, subject_id, reviewer_id, verdict, reason)
  on public.reviews to authenticated;
grant insert, update, delete on public.area_privacy to authenticated;

-- profiles: handles are public (attribution for CC BY-SA data).
create policy profiles_read on public.profiles for select to anon, authenticated
  using (true);
create policy profiles_insert_self on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- OpenBeta cache: public facts (ADR 001 D2). Written only by the server.
create policy area_cache_read on public.area_cache for select to anon, authenticated
  using (true);
create policy climb_cache_read on public.climb_cache for select to anon, authenticated
  using (true);
-- *_coords: deliberately no policies, and privileges revoked in schema v1.

-- area_privacy: reasons can be sensitive (e.g. landowner talks), so only
-- reviewers read and maintainers write. Clients never need it directly; the
-- formatter reads it server-side.
create policy area_privacy_read on public.area_privacy for select to authenticated
  using ((select private.has_trust('reviewer')));
create policy area_privacy_write on public.area_privacy for all to authenticated
  using ((select private.has_trust('maintainer')))
  with check ((select private.has_trust('maintainer')) and set_by = (select auth.uid()));

-- scans
create policy scans_read on public.scans for select to anon, authenticated
  using (
    status = 'published'
    or uploader_id = (select auth.uid())
    or (select private.has_trust('reviewer'))
  );
create policy scans_insert_own on public.scans for insert to authenticated
  with check (uploader_id = (select auth.uid()));
create policy scans_update_own_pending on public.scans for update to authenticated
  using (uploader_id = (select auth.uid()) and status in ('uploaded', 'failed_qc', 'pending_review'))
  with check (uploader_id = (select auth.uid()));
create policy scans_delete_own_unpublished on public.scans for delete to authenticated
  using (uploader_id = (select auth.uid()) and status <> 'published');

-- climbs: a published climb is public only while its scan is published, so a
-- scan takedown hides everything annotated on it.
create policy climbs_read on public.climbs for select to anon, authenticated
  using (
    (status = 'published'
      and exists (select 1 from public.scans s where s.id = scan_id and s.status = 'published'))
    or created_by = (select auth.uid())
    or (select private.has_trust('reviewer'))
  );
create policy climbs_insert_own on public.climbs for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (select 1 from public.scans s where s.id = scan_id and s.status = 'published')
  );
create policy climbs_update_own_pending on public.climbs for update to authenticated
  using (created_by = (select auth.uid()) and status = 'pending_review')
  with check (created_by = (select auth.uid()));
create policy climbs_delete_own_pending on public.climbs for delete to authenticated
  using (created_by = (select auth.uid()) and status = 'pending_review');

-- holds and paths follow their climb: visible when the climb is (the subquery
-- runs under climbs' own RLS), writable only on the author's pending climb.
create policy holds_read on public.holds for select to anon, authenticated
  using (exists (select 1 from public.climbs c where c.id = climb_id));
create policy holds_write_own_pending on public.holds for all to authenticated
  using (exists (select 1 from public.climbs c where c.id = climb_id
    and c.created_by = (select auth.uid()) and c.status = 'pending_review'))
  with check (exists (select 1 from public.climbs c where c.id = climb_id
    and c.created_by = (select auth.uid()) and c.status = 'pending_review'));
create policy paths_read on public.paths for select to anon, authenticated
  using (exists (select 1 from public.climbs c where c.id = climb_id));
create policy paths_write_own_pending on public.paths for all to authenticated
  using (exists (select 1 from public.climbs c where c.id = climb_id
    and c.created_by = (select auth.uid()) and c.status = 'pending_review'))
  with check (exists (select 1 from public.climbs c where c.id = climb_id
    and c.created_by = (select auth.uid()) and c.status = 'pending_review'));

-- grade_votes: individual votes stay private; distributions are exposed as
-- aggregates by #24. Votes only on published climbs.
create policy grade_votes_own on public.grade_votes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.climbs c where c.id = climb_id and c.status = 'published')
  );

-- reviews: an append-only audit trail. Reviewers write; contributors read the
-- verdicts on their own scans and climbs.
create policy reviews_read on public.reviews for select to authenticated
  using (
    (select private.has_trust('reviewer'))
    or reviewer_id = (select auth.uid())
    or (subject_type = 'scan' and exists (select 1 from public.scans s
      where s.id = subject_id and s.uploader_id = (select auth.uid())))
    or (subject_type = 'climb' and exists (select 1 from public.climbs c
      where c.id = subject_id and c.created_by = (select auth.uid())))
  );
create policy reviews_insert_reviewer on public.reviews for insert to authenticated
  with check ((select private.has_trust('reviewer')) and reviewer_id = (select auth.uid()));

-- Storage (ADR 002 §3). Keys: uploads/{uploader_id}/{scan_id}/raw/{file}.
-- Contributors touch only their own prefix, and only while the scan is
-- `uploaded`. `published` has no policies: public URLs work without one, and
-- with none the bucket can't be listed. `originals` is server-only.
create policy uploads_own_raw on storage.objects for all to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[3] = 'raw'
    and exists (select 1 from public.scans s
      where s.id::text = (storage.foldername(name))[2]
        and s.uploader_id = (select auth.uid()) and s.status = 'uploaded')
  )
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[3] = 'raw'
    and exists (select 1 from public.scans s
      where s.id::text = (storage.foldername(name))[2]
        and s.uploader_id = (select auth.uid()) and s.status = 'uploaded')
  );

-- PROBE (revert next): leak every climb to anon
create policy probe_leak on public.climbs for select to anon using (true);
