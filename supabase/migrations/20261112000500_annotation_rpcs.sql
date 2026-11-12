-- Atomic, validated climb annotation writes (issue #22, gaps A and E; decisions
-- on the issue). The server route validates a submission against the decoded
-- mesh (src/lib/annotations/validate.ts, TypeScript) and then calls one of two
-- functions that write the climb, holds and paths in a single transaction.
--
-- Validation can't run in SQL, so direct writes that would skip it are closed:
-- `authenticated` loses insert/update/delete on holds and paths and insert on
-- climbs. Climb metadata updates (name, description, grade, fa_info) and
-- deleting your own pending climb stay as before. Reads are unchanged.
--
-- The functions run as the service role, which bypasses RLS, so they re-check
-- in SQL everything RLS enforced: ownership, status, and that the scan is
-- published. They are `security definer` and executable by `service_role` only.

revoke insert, update, delete on public.holds, public.paths from authenticated;
revoke insert on public.climbs from authenticated;

-- Shared by both functions. Backstops for rules the validator already checks:
-- hold count, start holds, one path per kind. Reads a hold's hash from the
-- argument, never from the payload, so a hold can't claim another mesh.
create function private.write_annotations(
  p_climb_id uuid, p_scan_content_hash text, p_holds jsonb, p_paths jsonb
) returns void
language plpgsql set search_path = ''
as $$
declare
  starts int;
begin
  if jsonb_typeof(p_holds) is distinct from 'array'
     or jsonb_typeof(p_paths) is distinct from 'array' then
    raise exception 'holds and paths must be json arrays (invalid_payload)'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_holds) < 3 then
    raise exception 'a climb needs at least 3 holds (too_few_holds)'
      using errcode = '23514';
  end if;
  select count(*) into starts
    from jsonb_array_elements(p_holds) h where h ->> 'type' = 'start';
  if starts < 1 or starts > 2 then
    raise exception 'a climb needs 1 or 2 start holds (start_holds_count)'
      using errcode = '23514';
  end if;
  if (select count(distinct p ->> 'kind') from jsonb_array_elements(p_paths) p)
     <> jsonb_array_length(p_paths) then
    raise exception 'at most one path per kind (duplicate_path_kind)'
      using errcode = '23514';
  end if;

  insert into public.holds
    (climb_id, scan_content_hash, position, normal, face_index, type, seq_order)
  select p_climb_id, p_scan_content_hash,
         array(select jsonb_array_elements_text(h -> 'position')::double precision),
         array(select jsonb_array_elements_text(h -> 'normal')::double precision),
         (h ->> 'face_index')::integer,
         (h ->> 'type')::public.hold_type,
         (h ->> 'seq_order')::integer
    from jsonb_array_elements(p_holds) h;

  insert into public.paths (climb_id, kind, points)
  select p_climb_id, (p ->> 'kind')::public.path_kind, p -> 'points'
    from jsonb_array_elements(p_paths) p;
end
$$;
revoke all on function private.write_annotations
  from public, anon, authenticated, service_role;

-- Reads the scan under a share lock, so its mesh can't change before commit.
create function private.lock_published_scan(
  p_scan_id uuid, p_scan_content_hash text
) returns void
language plpgsql set search_path = ''
as $$
declare
  s record;
begin
  select status, content_hash into s
    from public.scans where id = p_scan_id for share;
  if not found or s.status <> 'published' then
    raise exception 'scan is not published (scan_not_published)'
      using errcode = '23514';
  end if;
  if s.content_hash is distinct from p_scan_content_hash then
    raise exception 'scan mesh changed; reload and retry (hash_mismatch)'
      using errcode = '23514';
  end if;
end
$$;
revoke all on function private.lock_published_scan
  from public, anon, authenticated, service_role;

create function public.create_climb_annotations(
  p_user_id uuid, p_scan_id uuid, p_scan_content_hash text,
  p_name text, p_description text, p_proposed_grade text, p_fa_info text,
  p_holds jsonb, p_paths jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_climb uuid;
begin
  perform private.lock_published_scan(p_scan_id, p_scan_content_hash);
  -- A duplicate name raises 23505 from climbs_scan_name_unique (#23).
  insert into public.climbs
    (scan_id, name, description, proposed_grade, fa_info, created_by)
  values (p_scan_id, p_name, coalesce(p_description, ''), p_proposed_grade,
          nullif(p_fa_info, ''), p_user_id)
  returning id into v_climb;
  perform private.write_annotations(v_climb, p_scan_content_hash, p_holds, p_paths);
  return v_climb;
end
$$;

-- Edit after "request changes" (a verdict, not a status: the climb is still
-- pending_review) and re-placing holds flagged stale by a mesh swap (#26): the
-- new holds carry the current hash, which clears annotations_stale_at.
create function public.replace_climb_annotations(
  p_user_id uuid, p_climb_id uuid, p_scan_content_hash text,
  p_holds jsonb, p_paths jsonb
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
begin
  select scan_id, created_by, status into c
    from public.climbs where id = p_climb_id for update;
  if not found or c.created_by is distinct from p_user_id then
    raise exception 'not your climb' using errcode = '42501';
  end if;
  if c.status <> 'pending_review' then
    raise exception 'only pending_review climbs can be edited (not_pending)'
      using errcode = '23514';
  end if;
  perform private.lock_published_scan(c.scan_id, p_scan_content_hash);
  delete from public.holds where climb_id = p_climb_id;
  delete from public.paths where climb_id = p_climb_id;
  perform private.write_annotations(p_climb_id, p_scan_content_hash, p_holds, p_paths);
end
$$;

revoke all on function public.create_climb_annotations, public.replace_climb_annotations
  from public, anon, authenticated;
grant execute on function public.create_climb_annotations, public.replace_climb_annotations
  to service_role;
