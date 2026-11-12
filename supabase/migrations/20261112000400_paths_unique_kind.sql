-- One path per kind per climb (issue #22, gap D). A climb has at most one
-- line, one topout and one downclimb; the annotation editor already replaces a
-- path by kind. Additive, with a dedupe pre-step: where a climb has several
-- paths of one kind, keep the newest by insertion order and drop the rest.
-- `paths` has no created_at, so "newest" is physical order (ctid), which
-- follows insertion for rows never updated; that is the best signal available.

delete from public.paths p
using (
  select ctid as row_id, row_number() over (
           partition by climb_id, kind order by ctid desc) as n
  from public.paths
) d
where p.ctid = d.row_id and d.n > 1;

alter table public.paths
  add constraint paths_climb_kind_unique unique (climb_id, kind);
