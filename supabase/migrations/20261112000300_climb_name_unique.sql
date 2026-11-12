-- One climb name per scan (issue #23). The annotation validator already
-- rejects duplicates (`name_duplicate`, src/lib/annotations/validate.ts); this
-- is the race-proof backstop, so two simultaneous submits can't both win.
--
-- Same normalisation as the validator's normName: trim, collapse runs of
-- whitespace to one space, lowercase. Any status counts, as in the validator,
-- so a rejected climb's name stays taken. Additive.

-- Existing duplicates would fail the index. Keep the oldest, number the rest
-- ("Name (2)") rather than delete contributed data.
with ranked as (
  select id, name,
         row_number() over (
           partition by scan_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
           order by created_at, id
         ) as n
  from public.climbs
)
update public.climbs c
   set name = left(btrim(r.name), 90) || ' (' || r.n || ')'
  from ranked r
 where c.id = r.id and r.n > 1;

create unique index climbs_scan_name_unique
  on public.climbs (scan_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));
