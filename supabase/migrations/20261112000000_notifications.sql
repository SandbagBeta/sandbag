-- In-app notifications (issue #19). A contributor sees a verdict on their own
-- scan or climb, with the reason, without email. Rows are created by a trigger
-- on `reviews`, so a notification exists exactly when its review does and the
-- lifecycle module needs no extra write. Nothing here touches `status`.

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  -- Account deletion removes the user's notifications; they carry no
  -- contributed data.
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- Each review notifies its author once.
  review_id  uuid not null unique references public.reviews (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

-- Users read their own, and may only set `read_at` on them. Rows are inserted
-- by the trigger below; the verdict and reason are read through `reviews`
-- (`reviews_read` already lets the author see them).
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_read_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_mark_read_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create function private.notify_review_author()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  author uuid;
begin
  if new.subject_type = 'scan' then
    select s.uploader_id into author from public.scans s where s.id = new.subject_id;
  elsif new.subject_type = 'climb' then
    select c.created_by into author from public.climbs c where c.id = new.subject_id;
  end if;
  -- Areas have no single author; anonymized authors (null) can't be notified.
  if author is not null and author is distinct from new.reviewer_id then
    insert into public.notifications (user_id, review_id) values (author, new.id);
  end if;
  return new;
end
$$;
revoke all on function private.notify_review_author from public;

create trigger reviews_notify_author
  after insert on public.reviews
  for each row execute function private.notify_review_author();
