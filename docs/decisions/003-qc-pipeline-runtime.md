# 003 — QC pipeline runtime: Edge Function vs worker

- **Status:** Proposed (spike). Waiting for the maintainer to decide D1–D6 below. Implementation of #16 starts after that.
- **Date:** 2026-11-10
- **Lane:** 3d
- **Refs:** #16 (QC pipeline; this is its spike half), #15 (upload flow, `enqueueQc` hook), #50 (storage adapter). PRD §2, §6.1, §7, §8, §9. [ADR 002](002-mesh-storage.md) (bucket layout, Edge Function limits, raw-file privacy). PLAN.md §5.

## How to read this document

Each figure is tagged with how it was checked:

- **[V]** checked on 2026-11-10 against the official page linked next to it (all sources listed at the end).
- **[M]** measured on the spike machine (below) with the scripts in `scripts/spikes/qc-bench/`.
- **[I]** my own inference. Not confirmed. Check before relying on it.

**Spike machine:** AMD Ryzen 5 3600XT (6 cores / 12 threads), 16 GB RAM, Windows 11, Node 24.20.0, `@gltf-transform/*` 4.5.1, `meshoptimizer` 1.3.0, `draco3dgltf` 1.5.x (temp install only). A desktop core is faster than a typical serverless vCPU; I assume cloud runs are **1.5–3× slower** [I].

---

## Context

PRD §9 puts the whole QC pipeline (magic bytes → parse → geometry checks → convert → compress → thumbnail → `qc_report`) in a Supabase Edge Function. ADR 002 already found that the Edge Function limits (256 MB memory, 2 s CPU) look too small for parsing and compressing a 50–200 MB mesh, but nobody had measured it. This spike measures it with the project's own pure-JS/wasm toolchain and proposes where each step runs, how jobs are started and recovered, and what the golden test set looks like.

The pipeline starts from `enqueueQc(job)` in `src/lib/upload/pipeline.ts`, a no-op stub that `verifyUploadComplete` calls after it has confirmed the raw object exists. Scans are born `uploaded`. Only `src/lib/lifecycle` `applyTransition` may move them: `uploaded → processing → failed_qc | pending_review`.

## Findings

### 1. Runtime limits

#### Supabase Edge Functions ([limits](https://supabase.com/docs/guides/functions/limits), [background tasks](https://supabase.com/docs/guides/functions/background-tasks), [ephemeral storage](https://supabase.com/docs/guides/functions/ephemeral-storage), [wasm](https://supabase.com/docs/guides/functions/wasm))

| Limit | Value | Tag |
|---|---|---|
| Memory | 256 MB | [V] limits |
| CPU time | **2 s per request**, excludes async I/O | [V] limits |
| Wall clock | 150 s Free, 400 s paid | [V] limits |
| Request idle timeout | 150 s, then 504 | [V] limits |
| Bundle size | 20 MB bundled by CLI, 5 MB bundled server-side (Dashboard/API) | [V] limits |
| `/tmp` | 256 MB Free, 512 MB paid | [V] ephemeral storage |
| Background tasks | `EdgeRuntime.waitUntil(promise)`; "capped based on the wall-clock, CPU, and memory limits"; a `beforeunload` event fires before shutdown. **No extra CPU budget** | [V] background tasks |
| WebAssembly | Supported (Rust/wasm-pack example, `static_files` in `config.toml`); page says Deno 1.46 | [V] wasm |
| Recursive calls | 30 per trace per 60 s | [V] limits |
| Local stack (`supabase start`) enforces the same CPU/memory caps | not documented | [I] |

#### Vercel Functions, Node.js runtime, Fluid compute ([limits](https://vercel.com/docs/functions/limitations), [runtimes](https://vercel.com/docs/functions/runtimes), [fair use](https://vercel.com/docs/limits/fair-use-guidelines), [cron](https://vercel.com/docs/cron-jobs/usage-and-pricing))

| Limit | Hobby (free) | Pro | Tag |
|---|---|---|---|
| Memory / CPU | 2 GB / 1 vCPU (fixed) | 2 GB default, up to 4 GB / 2 vCPU | [V] limits |
| Max duration | 300 s | 300 s default, 800 s max (1,800 s beta) | [V] limits |
| `/tmp` | 500 MB writable scratch | same | [V] runtimes |
| Bundle | 250 MB uncompressed (5 GB "large functions" beta) | same | [V] limits |
| Request/response body | 4.5 MB (so the worker must read the raw file from Storage, never receive it in a request) | same | [V] limits |
| Included usage | 4 h Active CPU, 360 GB-h provisioned memory, 1M invocations / month | usage-based ($0.128/CPU-h, $0.0106/GB-h) | [V] fair use |
| Cron | **once per day**, ±59 min | once per minute | [V] cron |
| Commercial use | **Hobby is non-commercial personal use only** (donations are allowed) | allowed | [V] fair use |
| `after()` / `waitUntil` | Runs after the response, within the route's `maxDuration`; works under `next start` and Docker too | same | [V] [Next.js `after`](https://nextjs.org/docs/app/api-reference/functions/after) |

#### Small always-on workers

| Option | Cheapest fitting size | Free tier | Tag |
|---|---|---|---|
| Fly.io Machines | shared-cpu-1x 1 GB $6.70/month, 512 MB $3.69/month, per-second billing; stopped machines pay rootfs $0.15/GB-month | No free tier for new orgs; $1 / 7-day trial; card required after; bills under $5 waived for personal orgs | [V] [Fly pricing](https://docs.fly.io/about/pricing) |
| Railway | Hobby $5/month incl. $5 usage; RAM $10/GB-month, vCPU $20/month | Free: $1/month credit, **0.5 GB RAM** per service | [V] [Railway plans](https://docs.railway.com/reference/pricing/plans) |

#### Supabase-side triggers and queues

| Mechanism | What it gives | Tag |
|---|---|---|
| Supabase Queues (pgmq) | Durable Postgres queue, "guaranteed delivery", exactly-once *within a visibility window*; `send`, `read(queue, sleep_seconds = visibility timeout, n)`, `pop`, `archive`, `delete` via `pgmq_public` | [V] [Queues](https://supabase.com/docs/guides/queues), [API](https://supabase.com/docs/guides/queues/api) |
| Supabase Cron (pg_cron) | Schedules "from every second to once a year"; can make HTTP calls | [V] [Cron](https://supabase.com/docs/guides/cron) |
| pg_net from cron | Documented pattern: Vault-stored secret + `net.http_post`; warning that the secret sits in `net.http_request_queue` until sent | [V] [scheduling functions](https://supabase.com/docs/guides/functions/schedule-functions) |
| Database Webhooks | Async (pg_net) POST after insert/update/delete; **no retry behaviour documented** | [V] [webhooks](https://supabase.com/docs/guides/database/webhooks) |
| Queues/Cron available on Free and in the local stack | not stated on the pages read | [I] (likely: both are Postgres extensions) |

### 2. Measurements

**Method [M].** `gen.mjs` builds the demo boulder (`scripts/lib/boulder-geometry.mjs`) at five resolutions and writes each as (a) a GLB with positions, normals, UVs, indices and a 4096² PNG texture (4.3 MB, compressible like a photo), and (b) a binary PLY with positions, vertex colours and faces. `bench.mjs` runs one file per fresh process and records wall time, process CPU time (user+system, so it includes V8 GC threads) and peak RSS. An empty Node process has a peak RSS of **49 MB**. Steps:

- *validate* = read file + magic bytes + header-only pass + full parse + prototype §9 checks (tri count, bounds, volume, degenerate faces, position-weld, boundary / non-manifold edges via sorted edge keys, floater fraction via union-find, texture size from the PNG/JPEG header).
- *full* = validate + `dedup/weld/prune` + compression + GLB write + SHA-256 + a 512² pure-JS thumbnail.

The synthetic meshes are clean (0 degenerate, 0 non-manifold, 0 floaters), so the checks ran their full cost but found nothing. Real phone scans have UV seams and duplicate vertices; expect weld to cost more on them [I].

**Validate only** (CPU ms / peak RSS MB):

| Triangles | GLB size | GLB | PLY size | PLY |
|---|---|---|---|---|
| 100k | 6.4 MB | 141 / 93 | 2.0 MB | 78 / 83 |
| 500k | 17.6 MB | 297 / 122 | 10.2 MB | 251 / 107 |
| 1M | 31.7 MB | 500 / 164 | 20.5 MB | 438 / 150 |
| 2M | 59.6 MB | 1,016 / 250 | 41.0 MB | 968 / 209 |
| 5M (PRD max) | 143.4 MB | 2,235 / 502 | 102.3 MB | 2,094 / 410 |

**Full pipeline, meshopt** (wall ms / CPU ms / peak RSS MB → output size):

| Triangles | GLB in | PLY in |
|---|---|---|
| 100k | 471 / 875 / **256** → 4.36 MB | 231 / 359 / 104 → 0.31 MB |
| 500k | 1,071 / 1,562 / 282 → 6.88 MB | 629 / 749 / 160 → 1.46 MB |
| 1M | 1,699 / **2,001** / 382 → 9.94 MB | 1,255 / 1,485 / 228 → 2.90 MB |
| 2M | 4,215 / 4,375 / 592 → 15.83 MB | 2,374 / 2,406 / 382 → 5.71 MB |
| 5M | 8,946 / 9,578 / **1,119** → 32.79 MB | 6,794 / 6,890 / 826 → 13.96 MB |

**Full pipeline, Draco** (same columns; Draco encoder is wasm, edgebreaker, speed 5):

| Triangles | GLB in | PLY in |
|---|---|---|
| 100k | 654 / 766 / 265 → 3.89 MB | 224 / 468 / 122 → 0.11 MB |
| 500k | 1,353 / 1,907 / 307 → 4.47 MB | 625 / 843 / 182 → 0.37 MB |
| 1M | 2,341 / 2,672 / 415 → 5.08 MB | 1,449 / 1,688 / 256 → 0.62 MB |
| 2M | 6,643 / 6,687 / 657 → 6.21 MB | 2,708 / 3,063 / 406 → 1.08 MB |

GLB outputs include the 4.3 MB texture unchanged; PLY outputs carry positions only (the spike parser drops vertex colours). For compressed-in-transit size, meshopt is meant to be gzip/brotli'd: 1M-tri PLY → meshopt 2.90 MB raw / 0.70 MB brotli vs Draco 0.62 / 0.37 MB; 2M-tri PLY → 5.71 / 1.10 vs 1.08 / 0.58 MB [M].

**Step breakdown at 2M triangles, GLB, meshopt** (wall ms): parse 70 · checks 895 · weld+dedup+prune 810 · meshopt reorder+quantize 1,857 · write 334 · SHA-256 9 · thumbnail 212 [M]. At 5M: checks 1,866 · weld 1,244 · meshopt 4,365 · write 798 · thumbnail 459.

**Header-only pass** (GLB JSON chunk or PLY header → triangle count): **< 1 ms** at every size, independent of file size [M]. Texture dimensions need one more small read at the image's bufferView offset (PNG IHDR / JPEG SOF).

**Determinism [M].** Two separate processes on the same input gave identical SHA-256 for 1M-tri GLB → meshopt (`33145d3d…`) and for 100k PLY → Draco (`01199647…`). The 100k GLB → meshopt hash was also identical between the repo copy and the temp copy of the script. Same input → same `content_hash` holds for this toolchain on one machine. Cross-platform/cross-version stability is [I]: pin `@gltf-transform/*`, `meshoptimizer` and the Draco encoder versions, and record them in `qc_report`.

**What this means for each runtime:**

- **Edge Function, full pipeline: does not fit.** Peak RSS is already ~250 MB, at the 256 MB cap, at **100k triangles** for a textured GLB (the weld step alone jumps RSS from ~90 to ~220 MB), and CPU passes 2 s at ~1M triangles on a desktop core, before the 1.5–3× cloud slowdown [M + I]. The hosted 50 MB upload cap (ADR 002 D2) admits GLBs of ~1.7M triangles, so even the Free-plan inputs are over budget. Deno's memory accounting differs from Node's RSS [I], but the margins are too large for that to matter.
- **Edge Function, validate only: fits only small inputs.** ~1M triangles is ~0.5 s CPU / 164 MB here; 2M is 1.0 s / 250 MB. With cloud slowdown and the downloaded bytes held in memory, the safe ceiling is roughly 500k–1M triangles [I]. That is below the PRD's 5M maximum, so it can't be the validator of record.
- **Edge Function, header-only checks: fits easily.** Magic bytes, size, triangle count from the header and texture size need a few KB via Range reads and < 1 ms CPU.
- **Vercel Function (Node), full pipeline: fits the PRD maximum.** 5M triangles peaks at 1.1 GB RSS (2 GB Hobby cap) and ~10 s CPU (300 s cap). Even at 3× slower that is ~30 s. Hobby's 4 h Active CPU/month covers about 1,400 jobs at 5M triangles or ~7,000 at 1M at desktop speed; divide by the 1.5–3× cloud factor [I: 14,400 s ÷ 10 s or ÷ 2 s].
- **Fly/Railway worker:** fits with ≥ 1.5 GB RAM; Railway Free (0.5 GB) fails above ~1M triangles for GLB. Costs $0–7/month on hosted, but adds a service for self-hosters.

### 3. Input conversion

| Input | Pure-JS path | Notes |
|---|---|---|
| GLB / glTF | `@gltf-transform/core` `NodeIO` | Draco- or meshopt-compressed *inputs* need the decoders registered (`draco3dgltf` is wasm, ~0.8 MB) [M: install size] |
| PLY (binary LE) | ~40-line reader (`checks.mjs` `parsePly`) | Parses 5M triangles in ~60 ms [M]. ASCII and big-endian PLY need small additions; `three`'s `PLYLoader` (already a dependency) is a fallback [I] |
| OBJ + MTL + textures (zip) | **`obj2gltf` is not a good fit**: 141 MB installed, pulls in `cesium` (79 MB) + `@cesium` (36 MB) [M] | Recommend a small indexed OBJ reader (or `three`'s `OBJLoader`, non-indexed, memory-heavy) plus a pure-JS unzip (e.g. `fflate`) [I]. `assimpjs` (wasm, 8.7 MB unpacked) was last published 2023 [M: npm metadata]. OBJ text is ~2–3× larger than binary PLY per triangle, so the 50 MB hosted cap admits roughly 0.5–1M OBJ triangles [I] |
| Textures | `@gltf-transform/functions` `textureCompress` needs `sharp` (native, prebuilt) | `sharp` is already in the tree via `next` and `@gltf-transform/functions` → `ndarray-pixels` [M: `pnpm why sharp`]. Texture resizing/KTX2 is the compression ADR's call; the texture dominates GLB output size at ≤ 1M triangles (4.3 of 4.4 MB at 100k) [M] |

### 4. Thumbnails

| Option | Edge Function | Vercel Node | Fly/Railway | Native deps | Notes |
|---|---|---|---|---|---|
| **Pure-JS software rasterizer** (`raster.mjs`) | CPU budget only for small meshes | Yes | Yes | **None** | [M] 512² flat-shaded PNG: 33–67 ms at 100k, 212 ms at 2M, 459 ms at 5M; ~4 KB PNG. Untextured; texture sampling is per-pixel, so ~+50 ms at 512² [I] |
| `three` + `gl` (headless-gl) | No | Hard: native addon, needs a GL context (Mesa/Xvfb on Linux) | Yes with a Docker image | **Yes** (`node-gyp`, `nan`, prebuilt binaries) | [V: npm metadata] conflicts with "self-hosters shouldn't need native deps" |
| Puppeteer + Chromium (SwiftShader) | No | Possible with a slim Chromium build, near the 250 MB bundle limit; slow cold start | Yes | **Yes** (Chromium binary) | [I] heaviest option; best fidelity |
| Client-generated, uploaded | n/a | n/a | n/a | None | The reviewer's browser already renders the mesh in the review queue (PRD §9) and could upload a thumbnail on approval. Untrusted input, so only acceptable from reviewers, and nothing exists before approval [I] |

**Recommendation:** pure-JS rasterizer in the worker for v1 (with texture sampling), PNG via `node:zlib`. ADR 002 names `thumb.webp`; WebP needs `sharp` (native but prebuilt and already installed) or a wasm encoder (D5).

### 5. Trigger and queue design

**Constraints from the code:**

- `enqueueQc` runs inside the contributor's request (`verifyUploadComplete`, session client). It must not do the work in-line, and repeat calls must be no-ops.
- `applyTransition` is compare-and-set on `status` only. It does not write any other column.
- The lifecycle allows `processing → failed_qc` and `processing → pending_review`, nothing back to `uploaded`, and nothing out of `failed_qc`.
- RLS (`20261110000100_rls_policies.sql`) makes published scan rows public in full, so `qc_report` must never contain location.

**Options:**

| Option | How a job starts | Recovery | Schema change | Notes |
|---|---|---|---|---|
| Q1. `qc_jobs` table + direct call + cron sweep | `enqueueQc` inserts `qc_jobs(scan_id)` (`on conflict do nothing`) with the service role, then calls the worker route via `after()` | Supabase Cron every minute calls the worker route through pg_net; it claims expired leases | New table `qc_jobs(scan_id pk → scans, attempts int, lease_until timestamptz, last_error text, pipeline_version text, created_at, updated_at)`, no anon/authenticated grants; a `claim_qc_job()` SQL function (`for update skip locked`, PostgREST can't express it); a cron job + Vault secret | Errors and attempt history stay private, off the public `scans` row |
| Q2. Supabase Queues (pgmq) | `enqueueQc` calls `pgmq.send('qc', {scan_id})` | Visibility timeout re-delivers; `read_ct` counts attempts | Enable `pgmq`, create queue `qc`, keep `pgmq_public` unexposed to anon/authenticated; same cron job | No unique key, so duplicates are possible; idempotency comes from the `uploaded → processing` CAS. Less SQL to write, more platform to learn |
| Q3. Database Webhook on `scans` | Trigger on `raw_path` set → pg_net POST to the worker | **None documented** [V] → still needs a sweep | Webhook trigger + secret | Duplicates Q1's sweep anyway |
| Q4. `scans.status` is the queue | `after()` call only | Sweep looks for `uploaded` scans with `raw_path` set and `processing` scans with an old `qc_started_at` | Add `qc_started_at timestamptz`, `qc_attempts int` to `scans` | Smallest change, but job bookkeeping lands on a public row |

**Recommended flow (Q1):**

1. `verifyUploadComplete` → `enqueueQc({scanId, rawPath})`. Server side, with the service role: set `scans.raw_path` if it is null (never from client input), insert the `qc_jobs` row (`on conflict do nothing`), then `after(() => runQc(scanId))`. A second call finds the row and does nothing.
2. `runQc` (route `POST /api/qc/run`, `runtime = "nodejs"`, `maxDuration = 300`, shared-secret auth, also callable by the sweep): claim the job (lease 6 min, `attempts + 1`). If `scans.status` is `uploaded`, `applyTransition(uploaded → processing)`; a `TransitionConflictError` means another runner has it, so stop. If it is already `processing` (a retry), continue.
3. Header pass via a Range read: magic bytes, size, triangle count, texture size. Fail fast on anything over budget (§6).
4. Download, parse, run the checks, build the canonical GLB (recentre, strip metadata), compress, hash, render the thumbnail.
5. Upload `uploads/{uploader}/{scan}/derived/{content_hash}.glb` and `thumb.png` (deterministic keys, so re-runs overwrite identical bytes; ADR 002 §3). Never write to `published` here.
6. Write `glb_path`, `content_hash`, `tri_count`, `texture_res`, `qc_report` with `… where id = ? and status = 'processing'`, then `applyTransition(processing → pending_review | failed_qc)`. A crash between the two leaves a `processing` scan with results, which the sweep re-runs harmlessly (same bytes, same hash). Better: let `applyTransition` take a column patch so it is one statement (D4).
7. Mark the job done (or delete it).

**Who writes what:**

| Column | Written by | When |
|---|---|---|
| `status` | `applyTransition` only | claim (`→ processing`), finish (`→ pending_review` / `failed_qc`) |
| `raw_path` | `enqueueQc`, service role, from the verified object key | before the job exists |
| `glb_path`, `content_hash`, `tri_count`, `texture_res` | QC worker | only on pass (left null on `failed_qc`, except `tri_count` when known) |
| `qc_report` | QC worker | always, pass or fail |

**`qc_report` and location.** Published rows are public, so the report must be built from an allow-list, never by dumping parser output:

- Bounds as **extents only** (`[2.5, 1.8, 1.8]` m), never min/max corners. A georeferenced scan's corners *are* its coordinates (UTM/ECEF offsets).
- Recentring is reported as a boolean, never as the offset.
- No EXIF, no glTF `extras`, no node/material/image names, no `asset.generator`/copyright strings, no original filename. Raw keys already use a fixed stored file name (`keys.ts`).
- The canonical GLB gets the same treatment: drop `extras`, names and image metadata, re-encode or strip textures so EXIF goes.
- A golden fixture enforces this (G5 below), and a unit test checks that no number in the report has an absolute value above ~1,000 [I: a heuristic tripwire, not a proof].

### 6. Failure modes

| Failure | Handling |
|---|---|
| Input over the job budget (> 5M triangles from the header, > 200 MB, or a projected peak memory over budget) | Fail fast in the header pass, **before** parsing: `failed_qc` with "This scan has 6.2M triangles; the limit is 5M. Decimate to under 5M (see capture guide)". Projected peak ≈ 200 MB + 185 MB per 1M triangles for a GLB with a 4K texture, ≈ 80 MB + 150 MB per 1M for PLY [M: fitted to the 1M–5M meshopt runs] |
| Worker killed (OOM, timeout) mid-job | Nothing is written, so the scan stays `processing` with an expired lease. The sweep retries. After 2 attempts it writes `failed_qc` with "Processing this file ran out of time/memory. Try a smaller export" and the attempt data. Never retry forever, never leave it silently stuck |
| Transient error (Storage 5xx, DB timeout) | Throw before writing results; the lease expires; the sweep retries (max 3 attempts total) |
| Bug in the pipeline marks good scans `failed_qc` | No way back today: `failed_qc` has no outgoing transitions. The contributor must upload again as a new scan (D3) |
| Stuck `processing` with no `qc_jobs` row (e.g. a manual change) | The sweep also scans `processing` scans older than 15 min without a live lease and treats them as expired |
| Lost `after()` call (deploy, crash before it ran) | The sweep picks up `qc_jobs` rows that were never claimed |
| Hosted Free 50 MB cap (#15, ADR 002 D2) | The upload is refused before QC. QC still enforces its own limits, because self-hosted and paid plans allow 200 MB |
| Duplicate runs (fast path + sweep at once) | Job claim uses `skip locked` + lease; the `uploaded → processing` CAS lets only one runner proceed; outputs are content-addressed |
| Zip bombs / huge OBJ zips | Check the uncompressed sizes in the zip central directory before inflating; cap total inflated bytes at the job budget [I] |

### 7. Golden test set (`fixtures/qc/`)

Every fixture is generated by a deterministic script (as `generate-demo-boulder.mjs` does) and committed. Each file stays **≤ 1 MB, and the whole set ≤ 6 MB**, so no Git LFS. Triangle counts are just above the 10k minimum. Large-input behaviour (1M–5M triangles, 50–200 MB) is not committed: it is covered by unit tests with synthetic headers and by the opt-in benchmark here.

**Good (must pass):**

| # | Fixture | Exercises |
|---|---|---|
| G1 | `good-polycam-like.glb`: 20k tris, 2048² JPEG, UV seams | GLB path, weld across seams, texture ≥ 2048 (no warning) |
| G2 | `good-scaniverse-like.ply`: 20k tris, binary LE, vertex colours, no texture | PLY path, vertex colour kept. "Texture present" must accept vertex colour (D6) |
| G3 | `good-obj.zip`: OBJ + MTL + 1024² JPEG | Zip + OBJ conversion; 1024 ≤ texture < 2048 passes with a **warning** |
| G4 | `good-draco.glb`: Draco-compressed input | Compressed-input decoding |
| G5 | `good-georeferenced.zip`: OBJ with UTM-sized offsets (e.g. +500,000 / +4,600,000) and a JPEG with EXIF GPS | Passes; canonical GLB recentred, EXIF stripped; `qc_report` has no absolute coordinates (ADR 002 §5) |

**Bad (must fail with the named reason):**

| # | Fixture | Check (PRD §9) | Expected message (draft) |
|---|---|---|---|
| B1 | `bad-magic.glb`: a JPEG renamed `.glb` | 1. extension/magic bytes | "This file says .glb but isn't a GLB (it looks like a JPEG). Export as GLB again." |
| B2 | `bad-truncated.glb`: valid header, body cut in half | 2. parse | "The file is incomplete or damaged (the mesh data ends early). Re-export and upload again." |
| B3 | `bad-too-few-tris.ply`: 2k tris | 2. triangle count in [10k, 5M] | "Only 2,000 triangles; we need at least 10,000. Export at a higher mesh quality." |
| B4 | `bad-scale-mm.glb`: 20k tris, 2,000 units across (millimetres) | 3. bounds 0.3–30 m | "The scan is 2,000 m across. It was probably exported in millimetres; export in metres." |
| B5 | `bad-flat.ply`: 20k coplanar tris | 3. volume > 0 | "The mesh is flat (no volume). Check that the whole boulder was captured." |
| B6 | `bad-floaters.glb`: 20k tris, 60% of vertices in disconnected fragments | 3. < 50% floater vertices | "60% of the mesh is disconnected floating pieces. Crop the scan to the boulder before exporting." |

Two more cover the remaining checks, so every check has a good and a bad case (lane guide). The issue's "6 bad" is a minimum:

| # | Fixture | Check |
|---|---|---|
| B7 | `bad-small-texture.glb`: 512² texture | 4. texture ≥ 1024 px (fail) |
| B8 | `bad-too-many-tris.ply`: header claims 6M faces, body truncated | 2. upper triangle bound + "too large" fast-fail, before any parse |

## Options considered

| Option | Fits PRD max (5M tris)? | Hosted cost | Self-host cost | Notes |
|---|---|---|---|---|
| A. Everything in a Supabase Edge Function (PRD §9 as written) | **No.** Memory cap reached at ~100k textured tris; CPU at ~1M [M] | $0 | $0 | Ruled out by measurement |
| B. Split: Edge Function header checks + worker for the rest | Yes | $0 + worker | Edge Function + worker | Two runtimes, Deno + Node, for a < 1 ms check the worker can do itself |
| **C. Node route in the existing Next.js app** (Vercel Function hosted, `next dev`/`next start` locally) + Postgres job table + Supabase Cron sweep | **Yes**, ~1.1 GB / ~10 s at 5M (cap 2 GB / 300 s on Hobby) | $0 on Hobby (non-commercial); Pro usage-based | **Nothing extra**: same process as the app | One codebase, one runtime, no native deps |
| D. Dedicated worker (Fly.io / Railway) polling the job table | Yes with ≥ 1.5 GB | ~$4–7/month; no real free tier | An extra service to deploy (breaks the 10-minute self-host) | Keep as the escape hatch if C hits limits |

## Decision

**Recommendation: C.** Run the whole QC job in Node inside the Next.js app, as a server-only module (`src/lib/qc/`) behind a secret-protected route handler. Start jobs from `enqueueQc` via a `qc_jobs` row plus `after()`, and recover them with a Supabase Cron sweep. Don't use an Edge Function for v1.

Budgets for the implementation:

- **Hard input limits:** ≤ 5M triangles (PRD), ≤ 200 MB raw (≤ 50 MB on hosted Free), checked from the header before parsing.
- **Memory:** target ≤ 1.5 GB peak at 5M triangles (measured 1.1 GB), below Vercel Hobby's 2 GB. Log `peakRssMB` and per-step timings into the job row (not the public report).
- **Time:** `maxDuration = 300`. Expect ≤ 30 s at 5M on a cloud vCPU [I]. The sweep lease is 6 min.
- **Self-hosting:** no new service, no native dependency, no paid tier. On a fresh clone, `pnpm dev` runs QC through the `after()` fast path. The cron sweep is a recovery path, and self-hosters can trigger it manually with a `pnpm qc:sweep` script [I: making pg_net reach the dev server from Docker needs a `host.docker.internal` URL].

## Consequences

- PRD §7 and §9 say "Edge Function". If this is accepted, they change to "Node worker route in the app" (follow-up docs edit in the implementation PR). PLAN.md §5's open question is answered by this ADR.
- #16 implementation PRs, in order (each within ~400 lines): (1) schema: `qc_jobs` + claim function + cron (backend lane, own PR); (2) `src/lib/qc/` pure checks + golden fixtures; (3) conversion/compression/thumbnail; (4) route, `enqueueQc` wiring, sweep.
- `@gltf-transform/*` and `meshoptimizer` move from devDependencies to dependencies; add a pure-JS unzip; add `draco3dgltf` only if Draco wins the compression decision or to decode Draco inputs (wasm, no native build).
- `qc_report` gets a typed shape in `src/lib/types.ts` (`QcCheckResult = {id, pass, severity, message, data}`), replacing `Record<string, unknown>`.
- The 5M-triangle limit gives a 32.8 MB meshopt GLB (texture included) [M], which is heavy for phones and for the egress budget in ADR 002. Decimation and texture targets belong in the compression ADR, and this pipeline is where they will run.

## Open questions for the maintainer

- **D1. Runtime:** accept C (Node route in the Next.js app, no Edge Function)? Note that Vercel **Hobby is non-commercial only** [V]. Alternatives are B or D.
- **D2. Queue:** Q1 (`qc_jobs` table, recommended), Q2 (Supabase Queues) or Q4 (two columns on `scans`)? Each needs a backend-lane migration first. The cron sweep needs pg_cron + pg_net + a Vault secret in every option.
- **D3. Lifecycle:** should a maintainer be able to re-run QC on a `failed_qc` scan (new `failed_qc → processing` transition) for when the pipeline itself was wrong? Today the only way out is a new upload. Also, should a `processing` scan that exhausts its retries go to `failed_qc` (this ADR's assumption) or to a separate state?
- **D4. Lifecycle API:** allow `applyTransition` to write a small, typed patch of QC columns in the same compare-and-set statement (one atomic update), instead of a separate write before the transition?
- **D5. Thumbnail format:** PNG from pure JS (no native deps), or WebP via `sharp` (native but prebuilt, already installed through `next`)? ADR 002 assumed `thumb.webp`.
- **D6. "Texture: present":** does a vertex-coloured PLY (Scaniverse's usual export) count as having a texture, or must PRD §9 check 4 become "texture or vertex colours"?
- **D7. Compression:** meshopt was 2–3× faster to encode here; Draco gave ~5× smaller geometry raw and ~2× smaller after brotli. This ADR doesn't decide it, but the compression ADR now has numbers to start from.

## Reproducing

```sh
# Generate inputs (100k–2M; add 5000000 for the PRD max, needs ~8 GB heap)
node scripts/spikes/qc-bench/gen.mjs <tmpdir> 100000,500000,1000000,2000000
# One run per process; prints one JSON line
node scripts/spikes/qc-bench/bench.mjs <tmpdir>/boulder-1000k.glb validate
node scripts/spikes/qc-bench/bench.mjs <tmpdir>/boulder-1000k.glb full meshopt <outdir>
```

The Draco runs need `draco3dgltf`, which is not a repo dependency: copy `bench.mjs`, `checks.mjs` and `raster.mjs` into a temp folder with `npm i @gltf-transform/core@4.5.1 @gltf-transform/functions@4.5.1 @gltf-transform/extensions@4.5.1 meshoptimizer@1.3.0 draco3dgltf` and run them from there.

## Sources

All accessed 2026-11-10.

- Supabase Edge Function limits: https://supabase.com/docs/guides/functions/limits
- Supabase background tasks: https://supabase.com/docs/guides/functions/background-tasks
- Supabase ephemeral storage: https://supabase.com/docs/guides/functions/ephemeral-storage
- Supabase WebAssembly: https://supabase.com/docs/guides/functions/wasm
- Supabase Queues: https://supabase.com/docs/guides/queues and https://supabase.com/docs/guides/queues/api
- Supabase Cron: https://supabase.com/docs/guides/cron
- Supabase scheduling Edge Functions (pg_cron + pg_net + Vault): https://supabase.com/docs/guides/functions/schedule-functions
- Supabase Database Webhooks: https://supabase.com/docs/guides/database/webhooks
- Vercel Functions limits: https://vercel.com/docs/functions/limitations
- Vercel runtimes (`/tmp`): https://vercel.com/docs/functions/runtimes
- Vercel fair use / Hobby allotments: https://vercel.com/docs/limits/fair-use-guidelines
- Vercel cron limits: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Next.js `after`: https://nextjs.org/docs/app/api-reference/functions/after
- Fly.io pricing: https://docs.fly.io/about/pricing
- Railway plans: https://docs.railway.com/reference/pricing/plans
