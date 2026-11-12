# 002 — Mesh storage: Supabase Storage vs Cloudflare R2

- **Status:** Accepted (2026-11-09). The maintainer decided D2–D4 as recorded below. Follow-up filed as #50.
- **Date:** 2026-11-09
- **Lane:** infra
- **Refs:** #18 (this spike), #2 (Supabase setup + buckets), #16 (QC pipeline), #15 (upload flow), #50 (storage adapter + R2). PRD §2, §5.1, §6.1, §7, §8, §9, §12. [ADR 001](001-openbeta-api.md) (location privacy).

## How to read this document

Each figure is tagged with how it was checked:

- **[V]** checked on 2026-11-09 against the official page linked next to it.
- **[I]** my own inference, from memory or from reasoning. Not confirmed on an official page during this spike. Check these before relying on them.

All cost math uses decimal units (1 GB = 1,000 MB) and list prices in USD, before tax. Prices change; re-check the linked pages before any purchase decision.

---

## Context

SandBag stores two kinds of mesh files (PRD §5.1, §8):

- **Raw uploads**: whatever the contributor's scan app exported (GLB/GLTF, OBJ+MTL+textures zipped, PLY). PRD §9 allows up to 200 MB.
- **Canonical GLB**: the Draco/meshopt-compressed file the QC pipeline produces. This is what the viewer loads and what holds are anchored to (by `content_hash`).

The PRD risk table (§12) assumed the problem was *storage size* (Supabase Free has 1 GB, R2 has 10 GB free) and proposed moving raw files to R2. This spike finds that **egress, not storage, is the binding constraint**, and that the Supabase Free plan's **50 MB per-file cap** conflicts with the PRD's 200 MB raw limit. Both points change the plan.

## Findings

### 1. Current pricing and limits

#### Supabase ([pricing](https://supabase.com/pricing), [egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress), [file limits](https://supabase.com/docs/guides/storage/uploads/file-limits), [Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn))

| Item | Free | Pro | Tag |
|---|---|---|---|
| Monthly price | $0 | from $25, includes $10 compute credits | [V] pricing |
| Storage included | 1 GB | 100 GB, then $0.0213/GB | [V] pricing |
| Uncached egress | 5 GB | 250 GB, then $0.09/GB | [V] pricing, egress |
| Cached egress (CDN hits) | 5 GB | 250 GB, then $0.03/GB | [V] pricing, egress |
| Egress quota scope | Unified across DB, Auth, Storage, Functions, Realtime | same | [V] egress |
| Over quota | No overage billing. Email + grace period, then the org may be restricted until next cycle | Billed per GB (unless spend cap) | [V] egress |
| Max file size (global limit) | **50 MB, cannot be raised** | Configurable up to 500 GB | [V] file limits |
| Per-bucket size / MIME limits | Yes, cannot exceed the global limit | same | [V] file limits |
| CDN | "Basic CDN" | Smart CDN (auto-invalidates on update/delete, up to 60 s) | [V] pricing, Smart CDN |
| Signed URLs on Smart CDN | Cached at the edge per token. Revoking a token does not purge its cached copy | same | [V] Smart CDN |
| Image transformations | Not included | 100 origin images, then $5/1,000 | [V] pricing (not relevant to GLB) |
| Project pausing | After 1 week of inactivity | Never | [V] pricing |
| Resumable uploads | TUS protocol, recommended above 6 MB, chunk size fixed at 6 MB, upload URL valid 24 h | same | [V] [resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) |
| S3 protocol | Multipart (Create/UploadPart/Complete/Abort/ListParts) and SigV4 presigned URLs supported; must be enabled in Storage settings; no versioning | same | [V] [S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility) |
| `createSignedUploadUrl` validity | 2 hours | same | [I] (fetch quota ran out before I could verify) |
| Storage billed as | GB-hours averaged over the cycle | same | [I] |
| Local stack file size limit | Set by `file_size_limit` in `supabase/config.toml` (default 50 MiB) | n/a | [I] |

#### Supabase Edge Functions ([limits](https://supabase.com/docs/guides/functions/limits), [ephemeral storage](https://supabase.com/docs/guides/functions/ephemeral-storage))

| Limit | Value | Tag |
|---|---|---|
| Memory | 256 MB | [V] |
| Wall clock | 150 s Free, 400 s paid | [V] |
| **CPU time** | **2 s per request** (excludes async I/O) | [V] |
| Request idle timeout | 150 s (then 504) | [V] |
| `/tmp` | 256 MB Free, 512 MB paid, reset every invocation | [V] |
| Request/response body size | Not documented on the limits page | [V] (absence) |
| Invocations | 500k Free, 2M Pro, then $2/M | [V] pricing |

#### Cloudflare R2 ([pricing](https://developers.cloudflare.com/r2/pricing/), [limits](https://developers.cloudflare.com/r2/platform/limits/), [multipart](https://developers.cloudflare.com/r2/objects/multipart-objects/), [public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/), [presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/))

| Item | Value | Tag |
|---|---|---|
| Free storage | 10 GB-month/month (Standard class only; Infrequent Access has no free tier) | [V] pricing |
| Storage price | $0.015/GB-month Standard; $0.01 Infrequent Access (30-day minimum, retrieval fees) | [V] pricing |
| Class A ops (writes: PutObject, CreateMultipartUpload, UploadPart, CompleteMultipartUpload, ListObjects, ...) | 1M free/month, then $4.50/M | [V] pricing |
| Class B ops (reads: GetObject, HeadObject) | 10M free/month, then $0.36/M | [V] pricing |
| Free ops | DeleteObject, AbortMultipartUpload | [V] pricing |
| **Egress** | **$0** via Workers API, S3 API and r2.dev | [V] pricing |
| Max object | ~5 TiB (4.995 TiB) | [V] limits |
| Max single PUT | ~5 GiB (4.995 GiB) | [V] limits |
| Multipart | parts 5 MiB to 5 GiB, all but last equal size, max 10,000 parts; incomplete uploads auto-abort after 7 days by default | [V] multipart |
| Presigned URLs | GET/HEAD/PUT/DELETE, expiry 1 s to 7 days, **S3 API domain only, not custom domains**; browser use needs bucket CORS | [V] presigned URLs |
| r2.dev public URL | Rate-limited, dev only, no caching/WAF | [V] public buckets |
| Custom domain | Must be a Cloudflare zone in the same account (partial CNAME setup allowed); enables Cloudflare cache | [V] public buckets |
| Default caching of `.glb`/`.gltf` | **Not cached by default**; needs a Cache Rule ("cache everything") | [V] [default cache behavior](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/) |
| Max cacheable file (Free zone) | 512 MB | [V] default cache behavior |
| Cache hits on a custom domain bill R2 Class B ops | No, a hit never reaches R2 | [I] |
| Cost of a domain | ~$10/year if the project doesn't already own one | [I] |

### 2. Cost model

**Assumptions** (all [I], chosen to be conservative):

- Canonical GLB: **10 MB** average (task range 5–15 MB). Costs scale linearly: halve for 5 MB, ×1.5 for 15 MB.
- Raw upload: **150 MB** average (range 100–300 MB, but capped at 200 MB by PRD §9).
- Thumbnails, QC reports and annotation JSON: negligible (<1% of bytes).
- **1,000 views per boulder per month**, each view downloads the full GLB once. Repeat visitors with a warm browser cache would lower this; I ignore that.
- CDN hit ratio for published GLBs: **0%** (no CDN) or **90%** (Smart CDN / Cloudflare cache, content-hash keys, `immutable`). 90% is a guess for a long-tail catalogue.
- Raw files retained for every published scan (see §5). Published GLB and raw are both counted in storage.

**Volumes:**

| Boulders | Published GLB | Raw retained | Total stored | Views/month | Egress/month |
|---|---|---|---|---|---|
| 10 | 0.1 GB | 1.5 GB | 1.6 GB | 10,000 | 100 GB |
| 100 | 1 GB | 15 GB | 16 GB | 100,000 | 1,000 GB |
| 1,000 | 10 GB | 150 GB | 160 GB | 1,000,000 | 10,000 GB |

**Supabase Free** (1 GB storage, 5 + 5 GB egress, 50 MB/file):

| Boulders | Fits? |
|---|---|
| 10 | No. Egress is 100 GB vs 10 GB quota (10× over). Raw (1.5 GB) exceeds storage, and any raw file over 50 MB is rejected outright |
| 100 / 1,000 | No |

Supabase Free serves about **1,000 views of a 10 MB mesh per month in total** (10 GB / 10 MB), across the whole site. That is the real free-tier limit, and the M5 launch target (10 boulders) passes it.

**Supabase Pro** ($25 base; storage overage $0.0213/GB above 100 GB; uncached $0.09/GB above 250 GB; cached $0.03/GB above 250 GB):

| Boulders | No CDN (0% hits) | Smart CDN (90% hits) |
|---|---|---|
| 10 | 100 GB uncached, in quota → **$25.00** | 90 cached + 10 uncached, in quota → **$25.00** |
| 100 | 1,000 GB: (1,000−250)×$0.09 = $67.50 → **$92.50** | 900 cached: (900−250)×$0.03 = $19.50; 100 uncached in quota → **$44.50** |
| 1,000 | 10,000 GB: 9,750×$0.09 = $877.50; storage (160−100)×$0.0213 = $1.28 → **$903.78** | 9,000 cached: 8,750×$0.03 = $262.50; 1,000 uncached: 750×$0.09 = $67.50; storage $1.28 → **$356.28** |

With 90% hits, Pro starts charging overage at about 28 boulders (cached quota: 250 GB / 9 GB per boulder), about $0.27 per boulder per month after that.

**Cloudflare R2** (egress $0; 10 GB free; Class B 10M free; Class A 1M free):

| Boulders | Storage | Class B (worst case, no cache: 1 GET/view) | Class A (uploads: ~20 ops per multipart raw upload + a few for GLB/thumbnail) | Total |
|---|---|---|---|---|
| 10 | 1.6 GB, free | 10k, free | ~250, free | **$0** |
| 100 | (16−10)×$0.015 = $0.09 | 100k, free | ~2.5k, free | **$0.09** |
| 1,000 | (160−10)×$0.015 = $2.25 | 1M, free | ~25k, free | **$2.25** |

Plus a domain (~$10/year [I]) if the project doesn't own one. The Cloudflare zone itself can be on the free plan [I].

**Takeaways:**

1. Storage size is cheap everywhere above the Supabase Free tier. Even 160 GB with raw files costs $1–3 per month.
2. Egress dominates. At 1,000 boulders it is roughly $356–904/month on Supabase Pro versus ~$0 on R2.
3. Retaining raw files multiplies stored bytes by ~16× but only costs dollars per month on paid storage. On Supabase Free it is impossible.
4. CDN caching helps on Supabase (about 2.5× cheaper) but does not change the conclusion. On R2 it only matters for latency and the Class B free tier.

Cheaper bytes per view also help on any backend: KTX2/Basis textures, meshopt, and LODs could plausibly cut a 10 MB GLB well below 5 MB. That belongs to the compression ADR / #16, not this one.

### 3. Bucket layout and access

#2 creates two Supabase buckets: `uploads` (private, pending scans) and `published` (public read, approved meshes). **The split is right**, because a public bucket is the only access mode that lets a CDN cache freely and keeps open data link-able without auth (PRD §2.1). I recommend these rules on top of it, for #2, #15 and #16 to implement:

**Object keys** (no area names, slugs, or coordinates in any key, so a key never reveals where a boulder is):

- `uploads/{uploader_id}/{scan_id}/raw/{original_filename}`: the contributor's file.
- `uploads/{uploader_id}/{scan_id}/derived/{content_hash}.glb` and `.../thumb.webp`: QC output while the scan is `pending_review`. **The pipeline must not write to `published` at QC time.** A processed but unreviewed mesh is still pending.
- `published/{scan_id}/{content_hash}.glb` and `published/{scan_id}/{content_hash}.webp`: written only on approval. Because the key contains the content hash, objects are immutable. Serve them with `Cache-Control: public, max-age=31536000, immutable`. A replaced mesh gets a new key, which matches PRD §7 hold anchoring.
- Raw originals of published scans stay private (see §5). Either they stay under `uploads/.../raw/` with no public policy, or they move to an `originals` private bucket. I prefer a separate `originals` bucket, so `uploads` can get an aggressive cleanup policy without risk to published data.

**Access rules:**

| Bucket | Anonymous | Contributor | Reviewer | Server (service role) |
|---|---|---|---|---|
| `uploads` | none | insert/read own prefix only, and only while the scan is `uploaded` | read via short-lived signed URL issued by the server | all |
| `published` | read by public URL; no list | none | none | write/delete only through the lifecycle module |
| `originals` | none | none | none | all; used by dataset export |

- `uploads` needs a bucket-level size limit (200 MB on Pro or self-host; 50 MB is forced on hosted Free) and a MIME allowlist [V: per-bucket limits exist].
- No `SELECT` policy on `storage.objects` for `published` for anon. Public-bucket downloads by URL don't need one [I], and this stops anyone listing the bucket. That isn't secret data, but it keeps the catalogue reachable only through the app's privacy-aware pages.
- **Signed URLs** are only for private objects: the review-queue viewer embed and the contributor's preview. Keep expiry short (about 10 minutes [I]). Smart CDN caches a signed response per token and revoking a token does not purge it [V], so a short expiry is the only real revocation. Never sign `published` URLs. Signing adds nothing to CC BY-SA data, breaks caching, and makes exports harder to link.

**Lifecycle coupling** (PRD §8 statuses `uploaded → processing → failed_qc | pending_review → published | rejected`). Object moves happen **only inside the lifecycle module's transitions**, never ad hoc:

- `pending_review → published`: copy `derived/*` to `published/{scan_id}/`, verify it (HEAD: size and hash), then write the status. If the copy fails, the status doesn't change. A `published` row never points at a missing object.
- `published → (unpublished / takedown)`, for example an access-sensitive area request: write the status first, then delete the public objects and purge the CDN. Supabase invalidates within 60 s [V]. On R2 + Cloudflare cache, this needs an explicit purge-by-URL call [I].
- `rejected`, `failed_qc`: no public objects ever exist. Retention per §5.
- Storage and Postgres aren't transactional, so add an idempotent reconcile job. It deletes `published/*` objects whose scan isn't `published` and flags `published` scans with missing objects. A public object with no matching published row is a privacy bug and should be treated as one.

**Should `published` stay on Supabase or move to R2?** From §2, egress makes Supabase the expensive place to serve views, and R2 the near-free one. For R2 the choice is **public bucket + custom domain**, not presigned URLs:

- Presigned URLs only work on the S3 API domain, not custom domains [V]. They bypass the Cloudflare cache, and they expire, which breaks shared links and exports.
- r2.dev is rate-limited and dev-only [V], so it is not an option for production.
- A Cache Rule is required because `.glb` isn't cached by default [V].
- CORS must allow the app origin(s) for GET [I].

`uploads` must never be public on R2 either. If uploads move to R2, the bucket stays private with no r2.dev and no custom domain. The only access path is server-issued presigned PUT/multipart URLs. Note that this moves the authorization check from Storage RLS into our signing route (ownership + `uploaded` status + size cap). Review that route as security-critical.

### 4. Upload path

- **Supabase:** use TUS resumable uploads (`tus-js-client` or Uppy) with 6 MB chunks [V] for anything over 6 MB, which covers every raw scan. RLS on `storage.objects` enforces the `{uploader_id}/` prefix. Upload URLs live 24 h [V], so an abandoned upload is safe to garbage-collect after that.
- **R2:** S3 multipart with server-issued presigned `UploadPart` URLs: create the upload server-side, presign each part, complete server-side. Parts are 5 MiB to 5 GiB and must be equal size [V]. A 200 MB file at 10 MiB parts is 20 parts, about 22 Class A ops. Set a lifecycle rule to abort incomplete uploads after 1 day; the default is 7 days [V]. Presigned multipart *parts* are standard S3 behavior, but the R2 presign page only documents single-object methods [V]. **Verify part presigning against R2 before building on it** [I].
- **Hosted Free plan:** the 50 MB global cap [V] means 200 MB raw uploads are **impossible on Supabase Free**. PRD §6.1's example rejection ("file > 200MB") assumes a limit the hosted Free tier can't reach. See D2.

**Edge Function limits and the #16 QC pipeline.** A 2 s CPU budget and 256 MB memory [V] rule out parsing a 100–200 MB OBJ/PLY, converting it, and Draco-compressing it inside an Edge Function. Network waits don't count against CPU time, but mesh parsing and compression are pure CPU. What an Edge Function *can* do idempotently:

1. React to upload completion. Read size and content-type from object metadata (HEAD).
2. Magic-byte check with an HTTP Range request for the first few KB, without downloading the file. Range support on Supabase Storage is [I]; it is standard on S3/R2.
3. Set `processing` through the lifecycle module and enqueue the job.

Conversion, compression and thumbnailing should run in a worker (see the #16 spike). Both Supabase Storage and R2 speak the S3 API [V], so the worker can use one S3 client against either backend. That is the basis of the adapter below.

### 5. Raw-file retention

**What "complete" requires for an open-data export** (PRD §2.1, §5.8, §10). A per-boulder export is complete when someone can reproduce everything SandBag shows, without SandBag:

1. The **canonical GLB** the annotations are anchored to, byte-identical, with its `content_hash`. Holds store position + face index + normal against this file (PRD §7). Without it the annotations are unusable, and a re-encoded or "equivalent" mesh is not good enough.
2. **Annotations JSON**: climbs, holds (type, sequence, position, normal, face index, `scan_content_hash`), paths (line/topout/downclimb), and community grade *distributions* (aggregate counts, no per-user votes).
3. A **manifest**: export schema version, scan id, SHA-256 of every file, license (CC-BY-SA-4.0), attribution (contributor handle), capture app, OpenBeta UUIDs, QC report.
4. **Location only via the formatter.** Coordinates appear only as `src/lib/location.ts` returns them. `hidden` means none at all (ADR 001).

The raw original is **not needed** for completeness in this sense, because nothing SandBag publishes is anchored to it. It is valuable, though: Draco quantization and texture downscaling are lossy, and full-resolution geometry and texture are what ML researchers want (PRD §10). Losing it is irreversible, so keep it.

**Privacy caveat (values-critical, [I]).** Raw files can carry location: EXIF GPS in zipped JPEG textures, and georeferenced vertex coordinates in some photogrammetry PLY/OBJ exports (UTM/ECEF offsets). A raw file from a `hidden` area could leak its position. So:

- Raw originals are **never served publicly** and never get a public URL.
- The #16 pipeline must strip metadata (GLB `extras`, EXIF) and recentre geometry to a local origin before writing the canonical GLB. Add a test case to the golden set: a georeferenced PLY and a GPS-tagged texture must come out clean.
- If originals are ever offered in a bulk dataset, that export runs the same sanitizer first and excludes `hidden`-area scans unless sanitized.

**Proposed retention policy:**

| Scan state | Raw upload | Derived GLB/thumb (private) | Public objects |
|---|---|---|---|
| Upload never completed | TUS URL dies at 24 h [V]; GC after 7 days | n/a | none |
| `failed_qc` | delete after 30 days (lets the contributor see the report and retry) | delete with raw | none |
| `pending_review` | keep | keep | none |
| `rejected` | delete after 30 days; keep `qc_report` and `reviews` rows | delete with raw | none |
| `published` | **keep indefinitely**, moved to private `originals` | delete after the copy to `published` | canonical GLB + thumb |
| Unpublished (by contributor or reviewer, no access issue) | keep private | n/a | deleted immediately + CDN purge |
| Access takedown | **deleted immediately** (D4) | n/a | deleted immediately + CDN purge |

**Cost impact** (from §2): keeping raw for published scans adds ~150 MB per boulder. At 1,000 boulders that is 150 GB: about **$1.28/month on Supabase Pro** (above the 100 GB included) or **$2.25/month on R2**. It is negligible on any paid tier and impossible on Supabase Free. R2 Infrequent Access ($0.01/GB) would save about $0.75/month at 1,000 boulders. That isn't worth its retrieval fees and 30-day minimum [V] until the archive is far larger.

## Options considered

| Option | Cost at 10 / 100 / 1,000 boulders (90% CDN) | Self-host | Notes |
|---|---|---|---|
| A. Supabase Free only | Breaks at 10 boulders (egress 10× over; 50 MB file cap) | Trivial | Fine for development only |
| B. Supabase Pro only | $25 / $44.50 / $356 | Trivial | Simple; RLS covers everything; egress grows linearly |
| C. Supabase for uploads (RLS), R2 for `published` + `originals` | Pro needed for >50 MB uploads: $25 / $25 / ~$27. On Free: $0 / $0.09 / $2.25 but 50 MB cap | Supabase default; R2 optional | Egress solved; uploads keep RLS |
| D. R2 for all mesh objects, Supabase Free for DB/Auth | ~$0 / $0.09 / $2.25 | Supabase default; R2 optional | Cheapest; 200 MB uploads on Free; authorization moves to the signing route |

## Decision

**Recommendation: keep Supabase Storage as the default backend and the self-host path; put every storage call behind a storage adapter; serve published meshes from R2 (public bucket + custom domain + cache rule) on the hosted instance before the public launch.**

- **D1. Now (M0–M2):** #2's two-bucket layout on Supabase is accepted, with the key, cache and access rules in §3. Add a private `originals` bucket (or the equivalent prefix). This is a request to #2 and #3, not something this PR does. QC output goes to `uploads/.../derived/`, never `published/`.
- **D2. Hosted raw-upload cap: decided (a).** Hosted Supabase Free caps raw uploads at 50 MB [V], and we accept that cap during development. PRD §6.1 and §9 now say the cap depends on the plan. Revisit at launch: (c) if the project wants to stay near $0/month, (b) if RLS should remain the only upload guard. The options were:
  - (a) Accept a 50 MB raw cap on the hosted instance until launch, and update PRD §9 to say the cap is plan-dependent.
  - (b) Supabase Pro ($25/month).
  - (c) Move `uploads` to R2 as well (option D).

- **D3. Accepted. `published` goes to R2 on the hosted instance** when the first of these happens. The project has no domain yet and will get one later, and a custom domain is a prerequisite (r2.dev is dev-only), so the move can't happen before then. Tracked in #50:
  - storage egress passes 50% of the plan's monthly quota (5 GB on Free, 250 GB on Pro);
  - or the public launch (M5) is scheduled.

  At the PRD's own launch target (10 boulders × 1k views = 100 GB/month), Free is exceeded by 10× and Pro is fine. Above ~28 boulders, Pro starts billing overage. Use a public bucket with a custom domain and a cache rule for `.glb`/`.webp`, with no r2.dev, no presigned reads, and immutable content-hash keys.
- **D4. Retention: decided.** As in the §5 table. Raw originals of published scans are kept indefinitely and are never public. **An access takedown deletes the raw original too**, along with the public objects and the CDN cache, so no copy of a sensitive scan survives. Still open: whether sanitized originals belong in the public dataset export, and if so as a separate tier. Decide this before #33.

### Self-hosting and the storage adapter

The README promises a self-host in under 10 minutes on the free tier. So **R2 must be strictly optional**. A fresh clone with `supabase start` and no Cloudflare account must work end to end. Every storage call (upload, QC worker, lifecycle copies, viewer URLs, export) goes through one storage adapter module, the same way coordinates go through one location formatter.

The adapter is an interface over **logical buckets** (`uploads`, `published`, `originals`), each with a fixed visibility (private or public). Callers never see provider bucket names, endpoints, or credentials. It offers:

- **start an upload session** for a key in a private bucket. It returns what the browser client needs: TUS endpoint and token for Supabase, or a multipart upload id plus presigned part URLs for R2. It is authorized by the caller passing the already-checked scan and user, and it enforces the size cap and MIME allowlist.
- **put** a small server-generated object (GLB, thumbnail, manifest) with content type and cache headers.
- **head** an object: size, content type, ETag/hash, or "missing".
- **read a byte range or stream** of an object, for magic-byte checks and the worker.
- **copy** an object between logical buckets. It may cross providers (Supabase `uploads` to R2 `published`), in which case the adapter streams the bytes.
- **delete** an object, and **purge** its public URL from any CDN in front of it (a no-op where invalidation is automatic).
- **get a read URL**: a stable public URL for public buckets, or a short-lived signed URL for private ones, with the expiry set by the caller and capped by the adapter. There is no way to get a public URL for a private bucket.
- **list by prefix**, for the reconcile and retention jobs only.

Configuration is per logical bucket: a driver (`supabase` default, `r2` optional) plus that driver's settings. Settings for R2 are the account id, the access key pair, the bucket name, and the public base URL. If no R2 variables are set, everything runs on Supabase. `.env.example` documents the optional R2 variables as optional, and the R2 secrets are server-only. Because both providers speak S3, the server-side half of each driver can share one S3 client [V: both support S3 multipart and SigV4]; only upload-session creation and public URL shape differ.

Keys are built only from ids and content hashes. The adapter never receives coordinates or area names, so it can't become a location leak.

**Implementation status (#50 Part 1, `src/lib/storage/`).** The interface (`types.ts`), the Supabase driver (`supabase.ts`) and `storageFor(client)` (`index.ts`) are in, and every storage call in the app and scripts goes through them: put, head, download, copy, delete, purge, `publicUrl`, `signedUrl` and `list`. The caller chooses the client and so the authority (service role for jobs, a user's RLS client where their own access authorizes the call). Keys are validated (ids, hashes and fixed file names only; no `..`, spaces or non-ASCII) before any provider call, a public URL cannot be built for a private bucket, signed URLs are capped at one hour and only exist for private buckets, and the provider's message is kept in `StorageError.detail` rather than `message`. **Publish step (#116, `src/lib/lifecycle/publish.ts`).** On approval `submitReview` copies the canonical GLB and thumbnail from `uploads/{uploader}/{scan}/derived/` to `published/{scan}/{content_hash}.glb` and `.webp` (content-hashed, so a one-year `max-age`; Supabase Storage cannot express `immutable`, the R2 driver can), re-hashing the GLB first, and sets `scans.glb_path` to the public key in the same compare-and-set that writes `status = published`. Only that exact derived key can be published. A failed copy leaves the scan pending and removes the review row; a lost status race removes the public copy again; the derived copies in `uploads` are deleted afterwards. **Not yet built (Part 2 or later):** the R2 driver and per-bucket driver config, upload sessions (the browser still talks TUS to Supabase directly under RLS, see `src/lib/upload/`), byte-range reads, and the lifecycle copy/purge and reconcile jobs. An ESLint rule banning `.storage.from` outside `src/lib/storage/` would enforce the "every call" promise the way `no-raw-coordinates` does; it is not added yet.

## Consequences

- PRD §12's risk row is corrected: the pressure is egress on published meshes, not raw storage size (PRD updated in this PR to point here).
- #2 / #3: add `originals` bucket (or prefix), bucket size/MIME limits, path-prefix RLS on `uploads`, no anon list on `published`. These are requests for those issues, not changes made here.
- #15: TUS uploads behind the adapter (#50 Part 1 lands first). The hosted cap is 50 MB during development (D2).
- #16: the Edge Function does only the HEAD/Range check and enqueue, because of the 2 s CPU / 256 MB limits [V]. Conversion runs in a worker that talks S3. The golden set gains metadata/georeference-stripping cases.
- Lifecycle module owns object copies/deletes alongside status writes, plus a reconcile job.
- Dataset export (M5) reads `published` + DB through the formatter. Originals are a separate, maintainer-gated tier.

## Follow-up issue (filed as #50)

Filed with one addition: the adapter (Part 1) should land before #15 and #16, while the R2 driver and migration (Part 2) wait for the trigger and a custom domain.

> **Title:** Storage adapter + serve published meshes from Cloudflare R2 (optional driver)
>
> **Labels:** `lane:infra`, `lane:backend` · **Milestone:** M5 Launch (or earlier if triggered)
>
> **Why:** ADR 002. At 1k views/boulder/month, a 10 MB GLB costs ~10 GB egress per boulder per month. Supabase Free covers ~1,000 views site-wide; Pro starts billing overage above ~28 boulders (~$356/month at 1,000 boulders with CDN). R2 egress is $0 (~$2.25/month storage at 1,000 boulders including raw originals).
>
> **Trigger:** storage egress > 50% of the plan quota in a billing cycle, or M5 launch scheduled, whichever first.
>
> **Scope:**
> 1. Storage adapter module over logical buckets `uploads` / `published` / `originals` (interface in ADR 002). Supabase driver is the default and keeps all current behavior; all existing storage calls migrate to it.
> 2. Optional R2 driver: S3 client, public base URL for public buckets, presigned multipart for private uploads (verify part presigning on R2 first).
> 3. Per-bucket driver config via env. `.env.example` documents R2 vars as optional, server-only.
> 4. Lifecycle publish/unpublish uses adapter copy/delete/purge; reconcile job covers both drivers.
> 5. One-off migration script: copy existing `published/*` to R2, verify hashes, flip the configured base URL, keep the Supabase copies for one cycle, then delete.
> 6. Cloudflare setup doc: custom domain, Cache Rule for `.glb`/`.webp`, r2.dev disabled, CORS for app origins, abort-incomplete-multipart lifecycle rule (1 day).
>
> **Acceptance:**
> - Fresh clone + `supabase start` with no R2 vars passes the full upload → QC → publish → view → export loop.
> - With R2 vars set, published GLBs load from the custom domain with `immutable` caching and a CDN hit on the second request.
> - The `uploads`/`originals` buckets are not readable without a server-issued signed URL (scripted denied-case test).
> - Unpublish removes the public object and purges the CDN within one minute.
> - Tests cover the adapter contract against both drivers (R2 via a local S3-compatible stand-in).

## Open questions for the maintainer

1. ~~D2~~ Decided: 50 MB cap during development.
2. ~~D3~~ Decided: trigger accepted. The domain will be acquired later.
3. D4: takedowns purge raw (decided). **Still open:** are sanitized originals part of the public dataset, and on what terms? Decide this before #33.
4. Is 1k views/boulder/month realistic? The model is linear in it. At 100 views/boulder, Supabase Pro covers ~280 boulders before overage.

## Sources

All accessed 2026-11-09.

- Supabase pricing: https://supabase.com/pricing
- Supabase egress: https://supabase.com/docs/guides/platform/manage-your-usage/egress
- Supabase storage file limits: https://supabase.com/docs/guides/storage/uploads/file-limits
- Supabase resumable uploads: https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- Supabase S3 compatibility: https://supabase.com/docs/guides/storage/s3/compatibility
- Supabase Smart CDN: https://supabase.com/docs/guides/storage/cdn/smart-cdn
- Supabase Edge Function limits: https://supabase.com/docs/guides/functions/limits
- Supabase Edge Function ephemeral storage: https://supabase.com/docs/guides/functions/ephemeral-storage
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 limits: https://developers.cloudflare.com/r2/platform/limits/
- Cloudflare R2 multipart objects: https://developers.cloudflare.com/r2/objects/multipart-objects/
- Cloudflare R2 public buckets: https://developers.cloudflare.com/r2/buckets/public-buckets/
- Cloudflare R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Cloudflare default cache behavior: https://developers.cloudflare.com/cache/concepts/default-cache-behavior/
