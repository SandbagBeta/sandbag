-- Foot holds are single optional points, not part of the line (user decision,
-- 2026-11-12). They belong to one climb (holds.climb_id already guarantees
-- that), have no order, and do not count toward the minimum number of holds.
-- Additive: replaces one private function and adds one constraint.
--
-- 1. Existing data first, so the constraint can be added:
--    * foot holds lose their seq_order;
--    * the remaining holds of each climb are renumbered 0..n-1 in their
--      current order, so the sequence has no gaps left by the removed feet.
--    Only seq_order changes. (The mesh-hash trigger fires only on climb_id and
--    scan_content_hash, so stale holds don't block this.)

update public.holds set seq_order = null
 where type = 'foot' and seq_order is not null;

with ranked as (
  select id,
         row_number() over (
           partition by climb_id order by seq_order, id) - 1 as n
    from public.holds
   where type <> 'foot' and seq_order is not null
)
update public.holds h
   set seq_order = r.n
  from ranked r
 where h.id = r.id and h.seq_order is distinct from r.n;

alter table public.holds
  add constraint holds_foot_unordered
  check (type <> 'foot' or seq_order is null);

-- 2. The write rules used by create_climb_annotations / replace_climb_annotations
--    (20261112000500). Same checks, with feet handled separately: at least 3
--    holds that are not foot holds, 1 or 2 start holds, feet carry no seq_order.
create or replace function private.write_annotations(
  p_climb_id uuid, p_scan_content_hash text, p_holds jsonb, p_paths jsonb
) returns void
language plpgsql set search_path = ''
as $$
declare
  starts int;
  non_foot int;
begin
  if jsonb_typeof(p_holds) is distinct from 'array'
     or jsonb_typeof(p_paths) is distinct from 'array' then
    raise exception 'holds and paths must be json arrays (invalid_payload)'
      using errcode = '22023';
  end if;
  select count(*) filter (where h ->> 'type' <> 'foot'),
         count(*) filter (where h ->> 'type' = 'start')
    into non_foot, starts
    from jsonb_array_elements(p_holds) h;
  if non_foot < 3 then
    raise exception 'a climb needs at least 3 holds that are not foot holds (too_few_holds)'
      using errcode = '23514';
  end if;
  if starts < 1 or starts > 2 then
    raise exception 'a climb needs 1 or 2 start holds (start_holds_count)'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_holds) h
     where h ->> 'type' = 'foot' and nullif(h ->> 'seq_order', '') is not null
  ) then
    raise exception 'foot holds are unordered and cannot have a sequence number (foot_in_sequence)'
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
