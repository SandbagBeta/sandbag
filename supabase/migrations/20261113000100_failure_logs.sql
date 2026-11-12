-- Private log of failures the user could not fix themselves (product decision,
-- 2026-11-12): when saving fails for a reason on our side, the server records
-- it here under a short reference and shows the user that reference and a link
-- to report it. Failures the user CAN fix (a hold off the surface, a duplicate
-- name, an expired sign-in) are explained in the UI and are not logged.
-- Additive.
--
-- Privacy: the app writes only the failing stage, a code, ids, a sanitized
-- provider message (<= 500 characters, coordinate-looking pairs removed) and a
-- few counts. Never file contents, hold positions, names or coordinates.
-- Retention is not automated yet: delete rows older than 90 days by hand.

create table public.failure_logs (
  id          uuid primary key default gen_random_uuid(),
  -- Short code the user can quote, e.g. SB-7K2M9QXA (Crockford base32).
  reference   text not null unique
    check (reference ~ '^SB-[0-9A-HJKMNP-TV-Z]{8}$'),
  stage       text not null check (stage in (
    'session', 'payload', 'scan', 'mesh', 'validation', 'access', 'database', 'unknown')),
  code        text not null check (length(code) between 1 and 40),
  -- Account deletion keeps the log but drops the link to the person.
  user_id     uuid references public.profiles (id) on delete set null,
  scan_id     uuid,
  climb_id    uuid,
  detail      text check (length(detail) <= 500),
  context     jsonb not null default '{}'
    check (jsonb_typeof(context) = 'object' and pg_column_size(context) <= 2048),
  -- Added by the user when they report the failure.
  user_note   text check (length(user_note) <= 1000),
  reported_at timestamptz,
  created_at  timestamptz not null default now()
);
create index failure_logs_created_idx on public.failure_logs (created_at desc);
create index failure_logs_user_idx on public.failure_logs (user_id);

alter table public.failure_logs enable row level security;

-- Only maintainers read the log. Nobody but the service role writes it, and
-- users do not read their own rows (the server function below confirms a
-- report without exposing the row).
revoke all on public.failure_logs from anon, authenticated;
grant select on public.failure_logs to authenticated;
create policy failure_logs_read_maintainers on public.failure_logs
  for select to authenticated
  using ((select private.has_trust('maintainer')));

-- The user adds a note to a failure they hit. Only the user the failure
-- happened to can do it, by reference. Service role only: the app checks the
-- session first. Returns false if no such failure belongs to that user.
create function public.report_failure(
  p_reference text, p_user_id uuid, p_note text
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  n int;
begin
  if p_note is null or length(trim(p_note)) = 0 or length(p_note) > 1000 then
    raise exception 'the note must be 1 to 1000 characters' using errcode = '22023';
  end if;
  update public.failure_logs
     set user_note = trim(p_note), reported_at = now()
   where reference = p_reference and user_id = p_user_id;
  get diagnostics n = row_count;
  return n > 0;
end
$$;
revoke all on function public.report_failure from public, anon, authenticated;
grant execute on function public.report_failure to service_role;
