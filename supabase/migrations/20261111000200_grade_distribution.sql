-- Grade vote distribution (issue #24, PRD §8).
--
-- grade_votes RLS shows each user only their own vote (20261110000100), so
-- the community distribution is exposed as aggregate counts only, through a
-- security definer function. No user ids, timestamps or per-user rows leave
-- the database.
--
-- * Only published climbs have a distribution; anything else returns no rows
--   (same answer as a climb that has no votes, so existence is not leaked).
-- * Readable by anon and authenticated (published data is public, PRD §2).
-- * Read-only: never writes votes or any status column.

create function public.climb_grade_distribution(p_climb_id uuid)
returns table (grade text, votes integer)
language sql stable security definer set search_path = ''
as $$
  select v.grade, count(*)::integer
  from public.grade_votes v
  join public.climbs c on c.id = v.climb_id
  where v.climb_id = p_climb_id and c.status = 'published'
  group by v.grade
  order by v.grade;
$$;

revoke all on function public.climb_grade_distribution from public;
grant execute on function public.climb_grade_distribution to anon, authenticated;
