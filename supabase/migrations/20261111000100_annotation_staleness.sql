-- Annotation versioning vs scan content hash (issue #26, PRD §7).
--
-- holds.scan_content_hash records which mesh a hold was placed on. When a
-- scan's mesh is replaced (scans.content_hash changes) the holds on its
-- climbs no longer line up with the mesh. Rather than silently breaking
-- positions we flag the dependent climbs for re-check and keep the old holds
-- until the annotator re-places them.
--
-- Rules this migration encodes:
-- * climbs.annotations_stale_at is trigger-maintained only. authenticated has
--   no insert/update grant on it (column grants in 20261110000100 are
--   per-column), so clients cannot set or clear it.
-- * It is set on every climb of a scan whose content_hash changes from one
--   non-null value to another. A first hash (null -> value) flags nothing.
-- * Holds must be written against the scan's current hash (hash_mismatch is
--   rejected with 23514); the flag clears once no hold of the climb carries
--   a stale hash.
-- * This SQL never writes status columns (lifecycle module owns those).

alter table public.climbs add column annotations_stale_at timestamptz;

create index climbs_annotations_stale_idx on public.climbs (scan_id)
  where annotations_stale_at is not null;

-- Mesh replaced: flag dependent climbs.
create function private.scans_flag_stale_annotations()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.climbs
     set annotations_stale_at = now()
   where scan_id = new.id and annotations_stale_at is null;
  return null;
end
$$;
revoke all on function private.scans_flag_stale_annotations
  from public, anon, authenticated, service_role;

create trigger scans_flag_stale_annotations
  after update of content_hash on public.scans
  for each row
  when (old.content_hash is not null
        and new.content_hash is distinct from old.content_hash)
  execute function private.scans_flag_stale_annotations();

-- Holds must match the scan's current mesh.
create function private.holds_check_scan_hash()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_hash text;
begin
  select s.content_hash into v_hash
  from public.climbs c join public.scans s on s.id = c.scan_id
  where c.id = new.climb_id;
  if v_hash is null or new.scan_content_hash <> v_hash then
    raise exception 'hold scan_content_hash does not match the scan mesh (hash_mismatch)'
      using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function private.holds_check_scan_hash
  from public, anon, authenticated, service_role;

create trigger holds_check_scan_hash
  before insert or update of climb_id, scan_content_hash on public.holds
  for each row execute function private.holds_check_scan_hash();

-- Clear the flag once every hold of the climb is on the current mesh.
create function private.holds_clear_stale_flag()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.climbs c
     set annotations_stale_at = null
   where c.id = new.climb_id
     and c.annotations_stale_at is not null
     and not exists (
       select 1 from public.holds h
       join public.scans s on s.id = c.scan_id
       where h.climb_id = c.id and h.scan_content_hash <> s.content_hash);
  return null;
end
$$;
revoke all on function private.holds_clear_stale_flag
  from public, anon, authenticated, service_role;

create trigger holds_clear_stale_flag
  after insert or update on public.holds
  for each row execute function private.holds_clear_stale_flag();
