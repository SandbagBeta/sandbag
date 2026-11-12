# 003 — QC pipeline runtime: Edge Function vs worker

- **Status:** Accepted (2026-11-10). The maintainer decided every open question; see [Owner decisions](#owner-decisions-2026-11-10). Implementation follows the [Implementation order](#implementation-order).
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

**Decided (O5):** the pure-JS rasterizer renders the pixels in the worker (with texture sampling), and `sharp` encodes them as `thumb.webp`, matching ADR 002. `sharp` is native, but it ships prebuilt binaries and is already installed with `next`, so self-hosters don't compile anything.

### 5. Trigger and queue design

**Constraints from the code:**

- `enqueueQc` runs inside the contributor's request (`verifyUploadComplete`, session client). It must not do the work in-line, and repeat calls must be no-ops.
- Today `applyTransition` is compare-and-set on `status` only. It doesn't write any other column, so lifecycle PR (b) adds a QC column patch (O4).
- Today the lifecycle allows `processing → failed_qc` and `processing → pending_review`, nothing back to `uploaded`, and nothing out of `failed_qc`. Lifecycle PR (b) adds `failed_qc → processing` (O3).
- RLS (`20261110000100_rls_policies.sql`) makes published scan rows public in full, so `qc_report` must never contain location.

**Options:**

| Option | How a job starts | Recovery | Schema change | Notes |
|---|---|---|---|---|
| **Q1. `qc_jobs` table + direct call + cron sweep (chosen, O2)** | `enqueueQc` inserts `qc_jobs(scan_id, raw_path)` (`on conflict do nothing`) with the service role, then calls the worker route via `after()` | Supabase Cron every minute calls the worker route through pg_net; it claims due jobs and expired leases | New table `qc_jobs(scan_id pk → scans, raw_path text, attempts int, run_after timestamptz, lease_until timestamptz, last_error text, pipeline_version text, created_at, updated_at)`, no anon/authenticated grants; a `claim_qc_job()` SQL function (`for update skip locked`, PostgREST can't express it); a cron job + Vault secret | Errors and attempt history stay private, off the public `scans` row |
| Q2. Supabase Queues (pgmq) | `enqueueQc` calls `pgmq.send('qc', {scan_id})` | Visibility timeout re-delivers; `read_ct` counts attempts | Enable `pgmq`, create queue `qc`, keep `pgmq_public` unexposed to anon/authenticated; same cron job | No unique key, so duplicates are possible; idempotency comes from the `uploaded → processing` CAS. Less SQL to write, more platform to learn |
| Q3. Database Webhook on `scans` | Trigger on `raw_path` set → pg_net POST to the worker | **None documented** [V] → still needs a sweep | Webhook trigger + secret | Duplicates Q1's sweep anyway |
| Q4. `scans.status` is the queue | `after()` call only | Sweep looks for `uploaded` scans with `raw_path` set and `processing` scans with an old `qc_started_at` | Add `qc_started_at timestamptz`, `qc_attempts int` to `scans` | Smallest change, but job bookkeeping lands on a public row |

**Flow (Q1, decided):**

1. `verifyUploadComplete` → `enqueueQc({scanId, rawPath})`. Server side, with the service role: insert the `qc_jobs` row with the verified object key as `raw_path` (`on conflict do nothing`; never from client input), then `after(() => runQc(scanId))`. A second call finds the row and does nothing.
2. `runQc` (route `POST /api/qc/run`, `runtime = "nodejs"`, `maxDuration = 300`, shared-secret auth, also called by the sweep): claim the job (lease 6 min, `attempts + 1`). If `scans.status` is `uploaded`, `applyTransition(uploaded → processing, patch {raw_path})`. A `TransitionConflictError` means another runner has it, so stop. If the scan is already `processing` (a retry), continue.
3. Header pass via a Range read: magic bytes, size, triangle count, texture size. Fail at once on a hard limit (§6, §8).
4. Download, parse, run the checks, build the canonical GLB (recentre, strip location metadata; O10), meshopt-compress (O7), hash, render the thumbnail and encode it as WebP (O5).
5. Upload `uploads/{uploader}/{scan}/derived/{content_hash}.glb` and `thumb.webp`. The keys are deterministic, so re-runs overwrite identical bytes (ADR 002 §3). Never write to `published` here.
6. `applyTransition(processing → pending_review | failed_qc, patch {glb_path, content_hash, tri_count, texture_res, qc_report})`: one compare-and-set update for status and results (O4). A crash before it leaves a `processing` scan with nothing written, which the sweep retries.
7. Mark the job done (or delete it).

**Who writes what** (all through `applyTransition`'s allowlisted patch, O4):

| Column | Written in | When |
|---|---|---|
| `status` | `applyTransition` | claim (`→ processing`), finish (`→ pending_review` / `failed_qc`), maintainer re-run (`failed_qc → processing`) |
| `raw_path` | patch on `uploaded → processing`, from `qc_jobs.raw_path` (the verified object key) | at claim |
| `glb_path`, `content_hash`, `tri_count`, `texture_res` | patch on `processing → pending_review` | only on pass. On `failed_qc` they stay null, except `tri_count` when known. `texture_res` stays null for vertex-coloured meshes |
| `qc_report` | patch on `processing → pending_review` or `→ failed_qc` | always, pass or fail. A re-run overwrites it |

**`qc_report` and location (O10).** Published rows are public, so the report is built from an allow-list, never by dumping parser output. These rules apply to **every** area, including `exact` ones:

- Bounds as **extents only** (`[2.5, 1.8, 1.8]` m), never min/max corners. A georeferenced scan's corners *are* its coordinates (UTM/ECEF offsets).
- Georeferenced meshes are always recentred. The report records a boolean, never the offset.
- No EXIF, no glTF `extras`, no node/material/image names, no `asset.generator`/copyright strings, no original filename. Raw keys already use a fixed stored file name (`keys.ts`).
- The canonical GLB gets the same treatment: drop `extras` and names, and re-encode textures so EXIF (including GPS) is gone.
- A golden fixture enforces this (G5 below), and a unit test checks that no number in the report has an absolute value above ~1,000 [I: a heuristic tripwire, not a proof].

### 6. Failure modes

| Failure | Handling |
|---|---|
| Input over the hard cap (> 5M triangles from the header, or > the plan's byte cap) | **Hard failure at once (O16)**, in the header pass, before downloading the body or parsing: `failed_qc` with "This scan is too large: 6.2M triangles; the limit is 5M. Decimate it to under 5M triangles and upload again." Projected peak memory at the cap ≈ 200 MB + 185 MB per 1M triangles for a GLB with a 4K texture, ≈ 80 MB + 150 MB per 1M for PLY [M: fitted to the 1M–5M meshopt runs], so 5M stays under Hobby's 2 GB |
| Genuine mesh failure (any hard check in §8: wrong type, corrupt, too few triangles, wrong scale, …) | `failed_qc` **immediately**, no retry (O8). The report carries the actionable message |
| Infrastructure error (Storage 5xx, DB timeout, network) | Throw before writing results. The job gets `run_after = now() + backoff` (1 min, then 5 min) and the sweep retries, **up to 3 attempts in total** (O8) |
| Worker killed (OOM, timeout) mid-job | Treated as an infrastructure error: nothing was written, the lease expires, and the sweep retries within the same 3-attempt budget. The header cap makes this rare |
| Retries exhausted | `processing → failed_qc` with a plain message: "Something went wrong on our side while checking this scan. It isn't a problem with your file; a maintainer has been notified." The error detail goes in `qc_jobs.last_error`, not in the public report (O8) |
| Bug in the pipeline marks good scans `failed_qc` | A maintainer re-runs QC through the new `failed_qc → processing` transition, triggered server-side only (O3). The re-run resets the job's attempts |
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
| G2 | `good-scaniverse-like.ply`: 20k tris, binary LE, vertex colours, no texture | PLY path, vertex colour kept. Vertex colours count as "texture present", and the resolution check is skipped (O6) |
| G3 | `good-obj.zip`: OBJ + MTL + 1024² JPEG, ~30% floater vertices | Zip + OBJ conversion; passes to review with **two soft warnings** (S1 texture, S2 floaters; O9) |
| G4 | `good-draco.glb`: Draco-compressed input | Decoding a Draco *input* (the output is still meshopt, O7) |
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
| B7 | `bad-small-texture.glb`: 512² image texture | 4. image texture ≥ 1024 px (H10) |
| B8 | `bad-too-many-tris.ply`: header claims 6M faces, body truncated | 2. 5M cap: instant "too large, decimate to under 5M" before any parse (H3, O16) |

The soft-warning thresholds in §8 (S3, S4) get unit tests on generated in-memory meshes rather than committed fixtures.

### 8. Hard and soft checks (O9)

A **hard** check fails the scan at once (`failed_qc`, severity `error`). A **soft** check passes the scan to review with severity `warning`, so a reviewer sees it next to the viewer. A scan reaches `pending_review` only when no hard check failed. Hard thresholds are the PRD §9 values. Soft thresholds are this ADR's starting values; change them only in a reviewed PR, never to make a test pass (lane guide).

| Id | Check | Hard: fail when | Soft: warn when |
|---|---|---|---|
| H1 | File type | extension and magic bytes disagree, or the format isn't GLB, glTF, PLY or OBJ-in-zip | — |
| H2 | File size | raw file > plan cap (200 MB; 50 MB on hosted Free) | — |
| H3 | Too large | header triangle count > 5,000,000 (O16) | — |
| H4 | Parse | file is corrupt or truncated, or has no triangle primitive | — |
| H5 | Too few triangles | < 10,000 | — |
| H6 / S3 | Scale | longest extent < 0.3 m or > 30 m | longest extent 0.3–0.5 m or 20–30 m ("check the export units") |
| H7 | Volume | enclosed volume < 0.1% of the bounding-box volume (flat or degenerate) | — |
| H8 / S2 | Floaters | ≥ 50% of vertices outside the largest connected piece | 20–50% |
| H9 | Colour present | no image texture **and** no vertex colours (O6) | — |
| H10 / S1 | Texture resolution (image textures only, O6) | longest side < 1024 px | 1024–2047 px |
| S4 | Mesh quality | — | > 1% degenerate faces, or > 1% non-manifold edges |

## Options considered

| Option | Fits PRD max (5M tris)? | Hosted cost | Self-host cost | Notes |
|---|---|---|---|---|
| A. Everything in a Supabase Edge Function (PRD §9 as written) | **No.** Memory cap reached at ~100k textured tris; CPU at ~1M [M] | $0 | $0 | Ruled out by measurement |
| B. Split: Edge Function header checks + worker for the rest | Yes | $0 + worker | Edge Function + worker | Two runtimes, Deno + Node, for a < 1 ms check the worker can do itself |
| **C. Node route in the existing Next.js app (chosen)** (Vercel Function hosted, `next dev`/`next start` locally) + Postgres job table + Supabase Cron sweep | **Yes**, ~1.1 GB / ~10 s at 5M (cap 2 GB / 300 s on Hobby) | $0 on Hobby (non-commercial); Pro usage-based | **Nothing extra**: same process as the app | One codebase, one runtime; only native piece is prebuilt `sharp` for WebP |
| D. Dedicated worker (Fly.io / Railway) polling the job table | Yes with ≥ 1.5 GB | ~$4–7/month; no real free tier | An extra service to deploy (breaks the 10-minute self-host) | Keep as the escape hatch if C hits limits |

## Decision

**Decision: C (O1).** Run the whole QC job in Node inside the Next.js app, as a server-only module (`src/lib/qc/`) behind a secret-protected route handler with `maxDuration = 300`. Start jobs from `enqueueQc` via a `qc_jobs` row plus `after()`, and recover them with a Supabase Cron sweep (O2). No Edge Function in v1.

**Hosting (O15):** the main deployment is non-commercial, so Vercel Hobby is allowed. Commercial use of a deployment would require Vercel Pro [V].

Budgets for the implementation:

- **Hard input limits:** ≤ 5M triangles (PRD, O16), ≤ 200 MB raw (≤ 50 MB on hosted Free), checked from the header before downloading or parsing.
- **Memory:** target ≤ 1.5 GB peak at 5M triangles (measured 1.1 GB), below Vercel Hobby's 2 GB. Log `peakRssMB` and per-step timings into the job row (not the public report).
- **Time:** `maxDuration = 300`. Expect ≤ 30 s at 5M on a cloud vCPU [I]. The sweep lease is 6 min.
- **Self-hosting:** no new service, nothing to compile (only `sharp`'s prebuilt binary, already installed with `next`), no paid tier. On a fresh clone, `pnpm dev` runs QC through the `after()` fast path. The cron sweep is a recovery path, and self-hosters can trigger it manually with a `pnpm qc:sweep` script [I: making pg_net reach the dev server from Docker needs a `host.docker.internal` URL].

## Consequences

- PRD §7 and §9 say "Edge Function" and "Draco-compress". The #16 implementation PR changes them to "Node worker route in the app" and "meshopt", and adds the hard/soft split from §8. PLAN.md §5's open question is answered by this ADR.
- Deploy note (#119): `draco3dgltf` loads its `.wasm` by file path, which a bundled build rewrites. `next.config.ts` lists it (and `sharp`) in `serverExternalPackages` and traces `draco3dgltf/*.wasm` into `/api/qc/run` via `outputFileTracingIncludes`. A decoder that fails to initialise throws `QcInfrastructureError`, which the worker retries; it is never a `parse` verdict.
- `@gltf-transform/*` and `meshoptimizer` move from devDependencies to dependencies. Add a pure-JS unzip. Add `draco3dgltf` (wasm, no native build) only to *decode* Draco-compressed inputs; the output is never Draco (O7). `sharp` becomes a direct dependency for WebP thumbnails (O5).
- `qc_report` gets a typed shape in `src/lib/types.ts` (`QcCheckResult = {id, pass, severity: "error" | "warning" | "info", message, data}` plus pipeline metadata), replacing `Record<string, unknown>`.
- The 5M-triangle limit gives a 32.8 MB meshopt GLB (texture included) [M], which is heavy for phones and for the egress budget in ADR 002. The codec is now decided (meshopt), but decimation and texture targets still belong in the compression ADR, and this pipeline is where they will run.

## Owner decisions (2026-11-10)

The maintainer answered every open question from the spike. The rest of this ADR has been updated to match.

| # | Question | Decision |
|---|---|---|
| O1 | Runtime | **Option C.** QC runs in Node inside the Next.js app: server-only `src/lib/qc/` behind a secret-protected route, `maxDuration = 300`. No Edge Function in v1 |
| O2 | Queue | **Dedicated `qc_jobs` table** + `claim_qc_job()` (`for update skip locked`) + a scheduled sweep for lost or stuck jobs (Q1) |
| O3 | Re-runs | **Add `failed_qc → processing`**, triggered server-side only (maintainer action, never the contributor's client) |
| O4 | Atomic results | **`applyTransition` takes a typed, allowlisted patch** of QC columns (`glb_path`, `content_hash`, `tri_count`, `texture_res`, `qc_report`, and `raw_path` where needed), applied in the same compare-and-set update as the status |
| O5 | Thumbnails | **WebP via `sharp`** (prebuilt, already installed with Next). The pure-JS rasterizer renders and `sharp` encodes |
| O6 | Vertex colours | **Count as "texture present".** The texture-resolution check applies only to image textures |
| O7 | Compression | **meshopt**, not Draco. Recorded here and in the decisions index; the compression ADR inherits it and covers decimation and texture targets |
| O8 | Auto-retry | **Up to 3 attempts with backoff, for infrastructure errors only.** Genuine mesh failures fail immediately. Exhausted retries → `failed_qc` with a plain "something went wrong on our side" message |
| O9 | Soft checks | **Borderline results pass to review as warnings**; hard failures (wrong type, corrupt, too few triangles, wrong scale, …) auto-fail. Thresholds in §8 |
| O10 | Location stripping | **Always**, for every area including `exact`: strip EXIF GPS, glTF `extras`, node/image/file names; recentre georeferenced meshes; `qc_report` bounds as extents only |
| O11 | Takedown | **Maintainer-only `published → rejected` with a recorded reason.** A lifecycle change, not part of #16; listed as a dependency (lifecycle PR (b)) |
| O12 | Reopen rejected | **No.** `rejected` stays final |
| O13 | Golden fixtures | **Commit to `fixtures/qc/`** (≤ 1 MB each, ~6 MB total) with a deterministic generator (§7) |
| O14 | Spike scripts | **Keep `scripts/spikes/qc-bench/`** in the repo |
| O15 | Hosting | The main deployment is non-commercial, so **Vercel Hobby is allowed**. Commercial use would require Pro |
| O16 | Size cap | **Hard cap 5M triangles read from the header**, with an instant "too large, decimate to under 5M" failure |

## Implementation order

Each step is its own PR, within ~400 lines where possible, and lands before the next one starts.

1. **(a) Backend schema PR** (lane:backend): the `qc_jobs` table (§5 Q1 columns, no anon/authenticated grants), the `claim_qc_job()` function (`for update skip locked`, honours `run_after` and expired leases), and the Supabase Cron + pg_net sweep with its Vault secret.
2. **(b) Backend lifecycle PR** (lane:backend): add `failed_qc → processing` (server-side only, O3); add maintainer-only `published → rejected` with a recorded reason (O11; `rejected` stays final, O12); give `applyTransition` the typed, allowlisted QC column patch (O4); add the `QcReport` / `QcCheckResult` types to `src/lib/types.ts`.
3. **(c) #16 implementation** (lane:3d), on top of (a) and (b): `src/lib/qc/` checks with the §8 thresholds, the golden fixtures and generator in `fixtures/qc/`, conversion, meshopt compression, location stripping, the thumbnail (rasterizer + `sharp` WebP), the route, the `enqueueQc` wiring, retry/backoff, and the PRD §7/§9 doc updates. Split it into several PRs if it passes the size target.

**Status of step (c) (#16):** All three PRs are done. PR 1: parsers, checks, golden set. PR 2: the route, `POST /api/qc/run`, and `src/lib/qc/worker.ts`. PR 3: the canonical GLB and thumbnail (`canonical.ts`, `strip.ts`, `thumbnail.ts`). Implementation notes for PR 3: (1) The GLB is built fresh from the parsed mesh, so no names, `extras` or extensions can carry over; one primitive, `weld` then `meshopt` (reorder, 14-bit position quantization, compress, `level: medium`). (2) Frame: the bbox centre is removed (this is the recentring; the report stores only a boolean) and y is shifted so the lowest point is 0. Holds are validated against the *decoded canonical GLB* (`flattenDocument` + `meshSurfaceFromParsed`), which includes quantization and meshopt's triangle reordering, so `face_index` refers to the stored GLB. (3) Texture: the one base-colour texture is kept with EXIF/XMP/text chunks stripped losslessly (`strip.ts`, no re-encode, so the hash is deterministic). Sources with more than one base-colour texture lose the texture (geometry and vertex colours only); atlas/multi-material support is a follow-up. (4) `glb_path` is the key inside the `uploads` bucket; publish copies it to `published` and rewrites the path. (5) The thumbnail is untextured flat shading; texture sampling is a follow-up. (6) The pinned toolchain (`@gltf-transform/*` 4.5.1, `meshoptimizer` 1.3.0) is identified by `qc_report.pipeline_version` (`qc-1.2.0`), so no schema change; bump it with any encoder bump. Determinism is tested in process (same input twice, same bytes); cross-platform stability remains [I].

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
