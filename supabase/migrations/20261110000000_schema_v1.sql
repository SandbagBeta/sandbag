-- Schema v1 (issue #3, PR 1 of 2): tables, types, constraints, indexes.
-- Source of truth: docs/PRD.md §8, ADR 001 (OpenBeta cache + location
-- privacy), ADR 002 (storage). PR 2 adds the RLS policies and denied-case
-- tests. Until then RLS is ENABLED with no policies on every table, so the
-- anon and authenticated roles can read and write nothing (deny by default).
--
-- Rules this schema encodes:
-- * We store the 3D layer only. OpenBeta metadata is a cache of facts, with
--   no prose, location text or media (ADR 001 schema flag 9).
-- * Raw coordinates live only in *_coords tables. Those have every privilege
--   revoked from anon/authenticated, and are read server-side through
--   src/lib/location.ts.
-- * location_privacy is SandBag-owned (area_privacy) and is never written by
--   a cache refresh.
-- * Status columns change only through the lifecycle module (PRD §8, #20).

-- Enums ------------------------------------------------------------------

create type public.lifecycle_status as enum (
  'uploaded', 'processing', 'failed_qc', 'pending_review', 'published', 'rejected'
);
create type public.trust_level as enum ('contributor', 'reviewer', 'maintainer');
create type public.hold_type as enum ('start', 'hand', 'foot', 'finish');
create type public.path_kind as enum ('line', 'topout', 'downclimb');
-- 'area' lets a reviewer clear area_cache.ancestors_changed_at (ADR 001 P3).
create type public.review_subject as enum ('scan', 'climb', 'area');
create type public.review_verdict as enum ('approve', 'request_changes', 'reject');
create type public.location_privacy as enum ('exact', 'fuzzed_1km', 'hidden');

-- People -------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  handle      text not null unique check (handle ~ '^[a-z0-9_]{3,32}$'),
  trust_level public.trust_level not null default 'contributor',
  created_at  timestamptz not null default now()
);

-- OpenBeta cache (ADR 001). Names and paths are public, even for hidden areas
-- (decision D2).

create table public.area_cache (
  openbeta_area_id     uuid primary key,
  name                 text not null,
  path_tokens          text[] not null,
  -- Root-first ancestor ids, excluding the area itself. Required for privacy
  -- inheritance; an ancestor missing from the cache ⇒ hidden (P1).
  ancestors            uuid[] not null,
  is_leaf              boolean,
  total_climbs         integer check (total_climbs >= 0),
  organizations        jsonb not null default '[]'::jsonb
                       check (jsonb_typeof(organizations) = 'array'),
  openbeta_updated_at  timestamptz,
  fetched_at           timestamptz not null,
  refresh_after        timestamptz not null,
  last_error           text,
  last_error_at        timestamptz,
  -- Set when a refresh re-parents the area. Non-null ⇒ the area and its
  -- descendants are hidden until a reviewer clears it (P3).
  ancestors_changed_at timestamptz
);
create index area_cache_ancestors_idx on public.area_cache using gin (ancestors);

create table public.area_cache_coords (
  openbeta_area_id uuid primary key
                   references public.area_cache (openbeta_area_id) on delete cascade,
  lat              double precision check (lat between -90 and 90),
  lng              double precision check (lng between -180 and 180),
  -- Corner order unconfirmed (ADR 001 §3); parser tests pin it.
  bbox             double precision[] check (bbox is null or cardinality(bbox) = 4)
);

create table public.climb_cache (
  openbeta_climb_id uuid primary key,
  openbeta_area_id  uuid not null references public.area_cache (openbeta_area_id),
  name              text not null,
  grades            jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(grades) = 'object'),
  is_boulder        boolean,
  fetched_at        timestamptz not null,
  refresh_after     timestamptz not null,
  last_error        text,
  last_error_at     timestamptz
);
create index climb_cache_area_idx on public.climb_cache (openbeta_area_id);

create table public.climb_cache_coords (
  openbeta_climb_id uuid primary key
                    references public.climb_cache (openbeta_climb_id) on delete cascade,
  lat               double precision check (lat between -90 and 90),
  lng               double precision check (lng between -180 and 180)
);

-- SandBag-owned privacy flags. No FK to area_cache on purpose: a flag must be
-- settable before (or survive without) a cache row.
create table public.area_privacy (
  openbeta_area_id uuid primary key,
  location_privacy public.location_privacy not null,
  reason           text not null check (length(trim(reason)) > 0),
  set_by           uuid references public.profiles (id) on delete set null,
  set_at           timestamptz not null default now()
);

-- 3D layer ---------------------------------------------------------------

create table public.scans (
  id                uuid primary key default gen_random_uuid(),
  uploader_id       uuid not null references public.profiles (id),
  openbeta_area_id  uuid references public.area_cache (openbeta_area_id),
  openbeta_climb_id uuid references public.climb_cache (openbeta_climb_id),
  status            public.lifecycle_status not null default 'uploaded',
  -- Storage keys (ADR 002 §3); never contain names, slugs or coordinates.
  raw_path          text,
  glb_path          text,
  content_hash      text check (content_hash ~ '^[0-9a-f]{64}$'),
  tri_count         integer check (tri_count >= 0),
  texture_res       integer check (texture_res > 0),
  qc_report         jsonb,
  capture_app       text,
  captured_at       timestamptz,
  license           text not null default 'CC-BY-SA-4.0'
                    check (license = 'CC-BY-SA-4.0'),
  created_at        timestamptz not null default now(),
  -- A published scan always points at a canonical mesh.
  constraint scans_published_has_mesh check (
    status <> 'published' or (glb_path is not null and content_hash is not null)
  )
);
create index scans_uploader_idx on public.scans (uploader_id);
create index scans_status_idx on public.scans (status);
create index scans_area_idx on public.scans (openbeta_area_id);

create table public.climbs (
  id             uuid primary key default gen_random_uuid(),
  scan_id        uuid not null references public.scans (id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  description    text not null default '',
  proposed_grade text not null,
  fa_info        text,
  -- Climbs skip upload/QC, so they enter the lifecycle at pending_review.
  status         public.lifecycle_status not null default 'pending_review',
  created_by     uuid not null references public.profiles (id),
  created_at     timestamptz not null default now()
);
create index climbs_scan_idx on public.climbs (scan_id);
create index climbs_status_idx on public.climbs (status);

-- Mesh-local geometry (canonical GLB frame, meters, Y-up). Not geographic.
create table public.holds (
  id                uuid primary key default gen_random_uuid(),
  climb_id          uuid not null references public.climbs (id) on delete cascade,
  -- Must equal the climb's scans.content_hash when written; re-processed
  -- meshes invalidate holds by hash mismatch (PRD §7). Enforced by #26.
  scan_content_hash text not null check (scan_content_hash ~ '^[0-9a-f]{64}$'),
  position          double precision[] not null check (cardinality(position) = 3),
  normal            double precision[] not null check (cardinality(normal) = 3),
  face_index        integer not null check (face_index >= 0),
  type              public.hold_type not null,
  seq_order         integer check (seq_order >= 0)
);
create index holds_climb_idx on public.holds (climb_id);

create table public.paths (
  id       uuid primary key default gen_random_uuid(),
  climb_id uuid not null references public.climbs (id) on delete cascade,
  kind     public.path_kind not null,
  -- [[x,y,z], ...] in the same mesh-local frame as holds.position.
  points   jsonb not null check (jsonb_typeof(points) = 'array')
);
create index paths_climb_idx on public.paths (climb_id);

create table public.grade_votes (
  climb_id   uuid not null references public.climbs (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  grade      text not null,
  created_at timestamptz not null default now(),
  primary key (climb_id, user_id)
);

create table public.reviews (
  id           uuid primary key default gen_random_uuid(),
  subject_type public.review_subject not null,
  -- scans.id, climbs.id, or area_cache.openbeta_area_id (polymorphic, no FK).
  -- Existence is checked by the lifecycle module that writes reviews (#20).
  subject_id   uuid not null,
  reviewer_id  uuid not null references public.profiles (id),
  verdict      public.review_verdict not null,
  reason       text,
  created_at   timestamptz not null default now(),
  -- Contributors always see why (PRD §6.1).
  constraint reviews_reason_required check (
    verdict = 'approve' or length(trim(coalesce(reason, ''))) > 0
  )
);
create index reviews_subject_idx on public.reviews (subject_type, subject_id);

-- Security defaults --------------------------------------------------------

-- Deny by default. PR 2 adds explicit policies per table.
alter table public.profiles           enable row level security;
alter table public.area_cache         enable row level security;
alter table public.area_cache_coords  enable row level security;
alter table public.climb_cache        enable row level security;
alter table public.climb_cache_coords enable row level security;
alter table public.area_privacy       enable row level security;
alter table public.scans              enable row level security;
alter table public.climbs             enable row level security;
alter table public.holds              enable row level security;
alter table public.paths              enable row level security;
alter table public.grade_votes        enable row level security;
alter table public.reviews            enable row level security;

-- Raw coordinates: column-level protection, not just missing policies. Even a
-- mistaken future policy can't expose them to the public API roles.
revoke all on public.area_cache_coords  from anon, authenticated;
revoke all on public.climb_cache_coords from anon, authenticated;
