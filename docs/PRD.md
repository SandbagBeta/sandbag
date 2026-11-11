# SandBagBeta — Product Requirements Document

**Status:** Draft v1.0 · 2026-11-09
**Owner:** Collin Vo ([@itscollinvo](https://github.com/itscollinvo))
**Repo:** `sandbagbeta/sandbag` · Code: AGPL-3.0 · Contributed data: CC BY-SA 4.0

---

## 1. Vision

SandBagBeta is an open-source 3D boulder visualizer built on community contribution. Climbers scan real boulders with their phones, upload the 3D renders, and annotate them with climbs: start holds, the line, topout, downclimb, and community grades. Anyone can then explore a boulder in 3D before they ever touch rock — and download the open dataset behind it.

Guidebooks are 2D, expensive, and gatekept. Mountain Project and OpenBeta give you text and photos. Nothing today lets you *walk around* a boulder, see where the start holds are, and understand the line in space. SandBagBeta is that missing layer: the open 3D layer on top of open climbing data.

The long game: every annotated hold on every scan is labeled training data. Once the dataset is large enough, a deep learning model can propose holds and lines on new scans automatically — a capability that doesn't exist anywhere, built on data no company owns.

## 2. Values

These are commitments, not aspirations. PRs and decisions that conflict with them get rejected.

1. **Open by default.** Code is AGPL-3.0 — improvements must flow back. Contributed scans and annotations are CC BY-SA 4.0 — the dataset can never be enclosed. Anyone can export/download the data.
2. **Respect access.** Climbing access is fragile. We inherit OpenBeta's area data (OpenBeta has no structured access-warning fields, so we show its local climbing organizations and keep our own privacy flags), let contributors flag sensitive areas, and support hiding or fuzzing precise coordinates where local climbing organizations request it. We never force publication of exact GPS for a flagged area.
3. **Community over moderators.** Quality control is automated checks plus community review — no single-gatekeeper bottleneck. Trust is earned and distributed.
4. **Don't duplicate open data.** Boulder/area/route metadata lives in OpenBeta. We store only what's new: the 3D layer (scans, holds, annotations, grade votes) linked to OpenBeta IDs.
5. **Contributor-friendly.** A new contributor should go from clone to running app in under 10 minutes, with free-tier services only.

## 3. Competitive landscape

**Kaya** ([kayaclimb.com](https://kayaclimb.com)) is the closest comparable: a VC-backed climbing app (free tier + Pro subscription) with digital guidebooks authored with local climbers, beta videos, GPS topos, and — in guidebook areas like Pawtuckaway and Squamish — 3D boulder models with route lines. Structurally, Kaya is the opposite of this project:

| | Kaya | SandBagBeta |
|---|---|---|
| 3D content produced by | Company/guidebook partners, top-down, per-area | Any climber with a phone, bottom-up, any boulder |
| Coverage model | Deep in paid guidebook areas, absent elsewhere | Grows wherever contributors climb |
| Access | Mobile app, guidebooks/features behind Pro paywall | Web, no install, no paywall |
| Data | Proprietary; no export, no API | CC BY-SA; per-boulder download + dataset export |
| 3D semantics | Display geometry (model + drawn line) | Structured hold data (type, sequence, topout, downclimb) → ML training data |
| Code | Closed | AGPL-3.0, self-hostable |
| Ecosystem | Replaces guidebooks | Builds on OpenBeta's open data |

Kaya validates the demand for 3D boulders — and its model guarantees it will only ever cover commercially viable areas. SandBagBeta wins where openness compounds: long-tail coverage, shareable web links (a climb you can link in a Discord thread), a dataset researchers and tool-builders can use, and semantic hold data no display-only model has. **Mountain Project / OpenBeta** have breadth of text/photo data but no 3D layer; we complement them rather than compete. One-off pro photogrammetry projects (e.g. Polycam showcase scans) prove the capture tech works but aren't platforms.

Honest gaps vs Kaya: they have beta videos, offline GPS guidebooks, gym partnerships, and polish from a funded team. v1 does not chase those; it builds the one thing they structurally can't — an open, community-owned, semantically annotated 3D layer.

## 4. Users

| Persona | Need | v1 story |
|---|---|---|
| **The visitor** | "What does this boulder actually look like? Where does it start?" | Browse areas, open a boulder in the 3D viewer, see annotated climbs, read grades/beta. No account needed. |
| **The contributor** | "I scanned this boulder, I want it on the map." | Sign in, upload a scan (GLB/OBJ/PLY from Polycam/Scaniverse/etc.), link it to an OpenBeta boulder, pass QC, annotate holds and lines. |
| **The reviewer** | "Keep junk out." | Review pending scans/annotations in a queue; approve, request changes, or reject with a reason. |
| **The researcher (v2)** | "Give me labeled mesh data." | Export scans + hold annotations in a documented format for ML training. |

## 5. Scope

### v1 (MVP — "working demo + seed data + first contributors")

1. **Scan upload** — authenticated upload of GLB/GLTF/OBJ/PLY (user exports from Polycam, Scaniverse, RealityScan, Luma, etc.); server converts everything to compressed GLB as the canonical serving format.
2. **Automated QC pipeline** — on upload: file validation, mesh integrity (non-empty, manifold-ish, triangle count bounds), texture presence/resolution, size limits. Pass → `pending_review`; fail → rejected with actionable reasons.
3. **Community review** — review queue; approvals promote scan to `published`. Early on, maintainers review; trust levels later.
4. **3D viewer** — Three.js (react-three-fiber): orbit/pan/zoom, hold highlighting, climb selection, start/topout/downclimb markers, mobile-friendly.
5. **Annotation tool** — click on the mesh to place holds (type: start / hand / foot / finish), draw the line (ordered hold sequence), mark topout + downclimb path, attach name/description/FA info.
6. **OpenBeta integration** — search OpenBeta's GraphQL API to attach a scan to an existing area/boulder/problem; store OpenBeta UUIDs; display their metadata and local climbing organizations; respect flagged/sensitive areas (no precise coords shown; privacy flags are SandBag-owned, see [ADR 001](decisions/001-openbeta-api.md)).
7. **Community grades** — logged-in users vote a V-grade per climb; show distribution, consensus, and the delicious "sandbagged" delta when community grade > guidebook grade.
8. **Browse & download** — area/boulder index, search, and per-boulder open-data export (GLB + annotations JSON, CC BY-SA).
9. **Auth & profiles** — Supabase auth (GitHub/Google OAuth), minimal profile, contribution history.

### v2 (next)

- **Guided in-app capture** — browser-based guided photo capture (coverage hints), server-side photogrammetry (COLMAP/Meshroom or Apple Object Capture pipeline) so contributors don't need a third-party app. *(Research spike is an M5 issue; this is the recommended path for capture: v1 rides on existing scan apps, v2 removes that dependency.)*
- **ML hold detection** — train a segmentation model on accumulated hold annotations; "suggest holds" in the annotation tool (human confirms — hybrid flow).
- **Trust levels** — reviewer status earned through accepted contributions.
- **Offline/PWA viewer**, gym mode (non-OpenBeta private boards), comments/beta videos.

### Non-goals (v1)

- No native mobile app; no in-app capture (v1 accepts uploads only).
- No photogrammetry processing server-side.
- No social feed, comments, or messaging.
- No route-setting tools for gyms.
- Not a logbook/ticking app (OpenBeta/other tools do this).

## 6. User flows

### 6.1 Contribute a scan
```
scan boulder w/ phone app (Polycam/Scaniverse/…) → export GLB/OBJ/PLY
→ sandbag: "Contribute" → upload file
→ search OpenBeta for area/boulder → attach (or request "new boulder" via OpenBeta)
→ automated QC runs (seconds–minutes, async)
   ├─ fail → rejection reasons shown ("mesh has 0 triangles", "file > 200MB") → fix & retry
   └─ pass → status: pending_review → appears in review queue
→ reviewer approves → published; contributor notified; scan live in viewer
```

### 6.2 Annotate a climb
```
open published scan → "Add climb" → click holds on mesh (raycast → store position
+ face normal + local patch) → tag each (start/hand/foot/finish) → order the sequence
→ mark topout & downclimb → name, description, proposed grade → submit
→ annotation QC (≥2 start holds? sequence connected? dupes?) → pending_review → published
```

### 6.3 Browse & view
```
landing → map/area list (OpenBeta data; flagged areas fuzzed/hidden) → boulder page
→ 3D viewer with climb list → select climb → holds glow, line draws, info panel
→ grade votes → "Download data" (GLB + JSON, CC BY-SA)
```

## 7. Architecture

```
┌────────────────────────────── Vercel ──────────────────────────────┐
│  Next.js (App Router, TypeScript)                                  │
│  ├─ UI: React + Tailwind                                           │
│  ├─ 3D: three.js via react-three-fiber + drei                      │
│  └─ API routes / server actions                                    │
└──────────┬─────────────────────────────┬───────────────────────────┘
           │                             │
┌──────────▼──────────────┐   ┌──────────▼──────────────────────────┐
│ Supabase                │   │ OpenBeta GraphQL API                │
│ ├─ Postgres (+ RLS)     │   │ (api.openbeta.io) — areas, boulders,│
│ ├─ Auth (OAuth)         │   │ climbs, local climbing orgs. R/O.   │
│ ├─ Storage (raw +       │   │ Cached in Postgres w/ TTL.          │
│ │   processed meshes)   │   └─────────────────────────────────────┘
│ └─ Edge Functions:      │
│     QC pipeline (upload → validate → convert → compress → GLB)    │
└─────────────────────────┘
```

**Key technical decisions**

| Decision | Choice | Why |
|---|---|---|
| Canonical mesh format | GLB (binary glTF 2.0) + Draco/meshopt compression | Web-native, streams into three.js, single file, compresses 5–10x |
| Accepted uploads | .glb/.gltf, .obj(+.mtl/textures zipped), .ply | Covers Polycam, Scaniverse, RealityScan, Luma export menus |
| Mesh processing | Edge Function (or small worker) using `gltf-transform`; `assimp`/`obj2gltf` for conversion | Pure-JS pipeline where possible; keeps self-hosting easy |
| Hold anchoring | Position (xyz) + face index + normal on the *canonical* GLB; annotations versioned against a scan content-hash | Survives recompression; invalidates cleanly if mesh is replaced. Enforced in SQL (#26): holds must match the scan's current hash, and replacing a scan's mesh sets `climbs.annotations_stale_at` on its climbs until the holds are re-placed. |
| OpenBeta coupling | Store `openbeta_area_id` / `openbeta_climb_id` UUIDs + cached snapshot of facts only (name, path, grade, organizations; no prose/photos) | Their data stays theirs; we degrade gracefully if API is down. See [ADR 001](decisions/001-openbeta-api.md) |
| Grades | V-scale votes, one per user per climb, show distribution not just mean | Matches boulder culture; resists brigading better than ratings |
| Access safety | `location_privacy` enum `exact / fuzzed_1km / hidden` in a SandBag-owned `area_privacy` table (OpenBeta has no such flags), set from local-org requests + maintainer/reviewer flags, inherited down the area tree (most restrictive wins). Default `exact` only when the lookup succeeds and no ancestor is flagged; any error, uncached area, missing/stale or re-parented ancestors → `hidden` (fail closed). `fuzzed_1km` is a deterministic per-area offset. Names are public; coordinates live in locked-down tables. See [ADR 001](decisions/001-openbeta-api.md) | Values §2 |
| Self-hosting | `supabase start` (local stack) + `vercel dev`; seed script with 2 demo scans | Values §5 |

## 8. Data model (v1)

```
users            (supabase auth) + profiles: handle, trust_level, created_at
scans            id, uploader_id, openbeta_area_id?, openbeta_climb_id?,
                 status: uploaded|processing|failed_qc|pending_review|published|rejected,
                 raw_path, glb_path, content_hash, tri_count, texture_res,
                 qc_report jsonb, capture_app?, captured_at?, license='CC-BY-SA-4.0'
climbs           id, scan_id, name, description, proposed_grade, fa_info?,
                 status (same lifecycle), created_by
holds            id, climb_id, scan_content_hash, position vec3, normal vec3,
                 face_index, type: start|hand|foot|finish, seq_order?
paths            id, climb_id, kind: line|topout|downclimb, points jsonb
grade_votes      climb_id, user_id, grade, created_at  (unique per user+climb)
reviews          id, subject_type: scan|climb|area, subject_id, reviewer_id,
                 verdict: approve|request_changes|reject, reason, created_at
area_cache       openbeta_area_id, name, path_tokens, ancestors uuid[], is_leaf,
                 total_climbs, organizations jsonb, openbeta_updated_at,
                 fetched_at, refresh_after, last_error?, ancestors_changed_at?
                 (public: names/paths of hidden areas are not secret)
area_cache_coords  openbeta_area_id, lat, lng, bbox   (no anon/authenticated SELECT)
climb_cache      openbeta_climb_id, openbeta_area_id, name, grades jsonb,
                 is_boulder, fetched_at, refresh_after
climb_cache_coords openbeta_climb_id, lat, lng       (no anon/authenticated SELECT)
area_privacy     openbeta_area_id, location_privacy: exact|fuzzed_1km|hidden,
                 reason, set_by, set_at   (SandBag-owned; never overwritten by refresh)
```

Row-level security: contributors edit their own pending items; published items immutable except through review; grade votes are per-user. RLS is row-level, so raw coordinates are protected by keeping them in separate tables with no public SELECT policy (or revoked column privileges), never by row policies alone; they are read only server-side through the location-privacy formatter. Cache shape, TTL and privacy rules: [ADR 001](decisions/001-openbeta-api.md). Deleting an account anonymizes its scans, climbs and reviews (author set to null) and deletes its grade votes; the CC BY-SA data stays. `subject_type: area` is how a reviewer clears `ancestors_changed_at` (ADR 001 P3). Implemented in `supabase/migrations/20261110000000_schema_v1.sql`.

## 9. QC pipeline (the "good enough" check)

**Automated (Edge Function, on upload):**
1. File: extension/magic-bytes match, size ≤ 200 MB raw (self-host and paid plans; hosted Supabase Free caps uploads at 50 MB, which is the hosted limit during development, per [ADR 002](decisions/002-mesh-storage.md) D2).
2. Parse: mesh loads, ≥ 1 mesh primitive, triangle count in [10k, 5M].
3. Geometry: bounding box sane (0.3m–30m — it's a boulder, not a pebble or a mountain), not degenerate (volume > 0), < 50% disconnected floater vertices.
4. Texture: present, ≥ 1024px on longest side (warn, don't fail, below 2048).
5. Output: convert → GLB, Draco-compress, generate thumbnail (headless render), write `qc_report`.

**Community (human):**
- Queue of `pending_review` scans/climbs with viewer embed + QC report.
- Reviewer checklist: is it actually a boulder, is it the claimed boulder, is coverage adequate, is the area not access-sensitive.
- v1: maintainers review. v2: trust-level users.

## 10. ML roadmap (v2 — designed for from day one)

- Every published hold = (mesh patch, position, type) label. The annotation tool is a **labeling tool in disguise**.
- Export format issue (M5): scans + holds as a documented dataset (GLB + JSON manifest), versioned, CC BY-SA.
- Candidate approach: sample local geometry patches (curvature, normals) + texture around annotated points → train patch classifier / mesh segmentation (e.g., point-cloud or mesh CNN) → propose candidate holds on new scans → human confirms in the same annotation UI (hybrid flow).
- Success gate to start training: ≥ 50 published scans / ≥ 1,500 annotated holds.

## 11. Success metrics

**v1 ships when (demo + seed):**
- Deployed on a public URL; upload → QC → review → annotate → view loop works end-to-end.
- ≥ 10 published boulder scans with ≥ 20 annotated climbs (Collin seeds from a local area, e.g. a NJ/NY bouldering spot).
- A stranger can self-host from the README in < 10 min.

**Community traction (3 months post-launch):**
- ≥ 5 external contributors with a published scan; ≥ 100 grade votes.
- Posted to OpenBeta community + r/bouldering + climbing Discords; at least one local climbing org aware/supportive.

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Scan quality from phone apps is inconsistent | Junk in viewer | Hard QC gates + review queue; capture guide doc with per-app tips |
| OpenBeta API changes/downtime | Browse breaks | Cache snapshots in Postgres; degrade to cached data |
| Mesh egress and file-size limits blow the free tier (Supabase Free: 1GB storage, 5+5GB egress, 50MB/file) | Cost | Aggressive compression; storage adapter with optional Cloudflare R2 driver (zero egress) for published meshes at a traffic threshold. See [ADR 002](decisions/002-mesh-storage.md) |
| Access backlash from climbing community | Project reputation | Values §2 enforced in code (location_privacy); engage orgs early |
| Annotation UX is hard (3D picking on mobile) | Contribution funnel dies | Desktop-first annotation; viewer works everywhere; usability issue in M3 |
| Solo maintainer burnout mid-semester | Stall | Agent-parallel workflow (PLAN.md); small issues; ruthless v1 scope |
| ML model never materializes | Core promise unmet | v1 is valuable without it; dataset export makes it possible for *anyone* |

## 13. Milestones (summary — full breakdown in PLAN.md)

| # | Milestone | Outcome |
|---|---|---|
| M0 | Foundation | Repo, CI, Next.js + Supabase skeleton deployed, schema v1 |
| M1 | Viewer | GLB loads in r3f viewer from Storage; demo scan hardcoded |
| M2 | Upload + QC | Auth, upload flow, conversion/QC pipeline, review queue |
| M3 | Annotation | Hold placement, lines, climb lifecycle, grade votes |
| M4 | OpenBeta + browse | Area/boulder pages, search, attach flow, access safety |
| M5 | Launch | Seed 10 scans, polish, docs, dataset export, community posts |
