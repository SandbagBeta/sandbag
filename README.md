# 🧗 SandBag

**Open-source 3D boulder visualizer, built on community contribution.**

Climbers scan boulders with their phones, upload the renders, and annotate them in 3D — start holds, the line, topout, downclimb, community grades. Everyone else gets to walk around the boulder before they ever touch rock. All of it open: AGPL-3.0 code, CC BY-SA 4.0 data.

> *sandbag (v.): to rate a climb easier than it actually is. We keep the receipts.*

## How it works

```
📱 scan a boulder (Polycam / Scaniverse / any app that exports GLB/OBJ/PLY)
→ ⬆️ upload — automated quality checks + community review
→ 📍 attach to real climbing data via OpenBeta
→ ✍️ annotate holds, lines, topout, downclimb
→ 🧗 anyone can view in 3D, vote grades, download the open data
```

## Status

🚧 Pre-alpha — building toward v1. See [PLAN.md](PLAN.md) for the roadmap and [docs/PRD.md](docs/PRD.md) for the full product spec. Issues labeled `good-first-issue` are a great place to start.

## Quickstart (dev)

Prereqs: Node 24+, pnpm, [Supabase CLI](https://supabase.com/docs/guides/cli), Docker.

```bash
git clone https://github.com/sandbagbeta/sandbag && cd sandbag
pnpm install
supabase start               # local Postgres/Auth/Storage stack (needs Docker)
cp .env.example .env.local   # then paste the keys printed by `supabase start`
                             # (`supabase status` reprints them any time)
pnpm seed                    # demo GLB + 1 scan, 2 climbs, holds, paths
pnpm dev                     # http://localhost:3000
```

Check the wiring at <http://localhost:3000/api/health> — it reports `"supabase": "configured"` once `.env.local` is filled in. `supabase/config.toml` declares three storage buckets: `uploads` (private, raw contributor scans), `published` (public, QC-approved GLBs) and `originals` (private, raw files of published scans); `supabase start` creates them. `supabase start` also applies `supabase/migrations/`. Run the database tests with `supabase test db`.

`pnpm seed` validates the committed demo fixture (`public/fixtures/demo-boulder.glb` + `src/lib/fixtures/demo-boulder.json`, see [public/fixtures/README.md](public/fixtures/README.md)) and, when `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in `.env.local`, uploads the GLB to the `published` storage bucket, then upserts the demo scan, its 2 climbs, their holds and paths, and publishes them through the lifecycle module (`src/lib/lifecycle`). It is safe to re-run: rows are keyed on the fixture's fixed ids, and already-published rows are left alone. Demo rows have no author (`uploader_id`/`created_by` are null). If a demo row ends up somewhere it cannot be published from, `npx supabase db reset` starts the local database fresh. Without the env vars it just reports and exits 0, so the quickstart works with no Supabase stack. As a guard against pointing a service-role key at production, it only writes to `localhost`/`127.0.0.1` unless you pass `pnpm seed --force`. The service-role key is for scripts only — never expose it under a `NEXT_PUBLIC_` name.

### Setting up OAuth locally

Sign-in uses GitHub and Google through Supabase Auth. The provider redirects to Supabase's callback, which then sends the browser to the app's `/auth/callback`. Register this callback URL with both providers:

```
http://127.0.0.1:54321/auth/v1/callback
```

1. **GitHub:** Settings → Developer settings → OAuth Apps → New OAuth App. Homepage URL `http://127.0.0.1:3000`, authorization callback URL as above. Copy the client ID and generate a client secret.
2. **Google:** Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID → *Web application* (configure the consent screen first if asked). Add the callback URL above under *Authorized redirect URIs*.
3. Set the four `SUPABASE_AUTH_EXTERNAL_*` variables listed in `.env.example`. The Supabase CLI reads them (via `env(...)` in `supabase/config.toml`), not Next.js, so export them in your shell or put them in `supabase/.env` (git-ignored). Never commit them.
4. Restart the stack (`supabase stop && supabase start`), run `pnpm dev`, open <http://127.0.0.1:3000/sign-in> and pick a provider. On first sign-in you get a profile with a handle derived from your provider username or name, which you can change at `/account`. `127.0.0.1:3000` and `localhost:3000` are both allowed redirect targets; stay on one host for the whole flow, since the PKCE verifier cookie is per host.

`/account` requires a signed-in user. Gated routes are listed in `GATED_PATH_PREFIXES` (`src/lib/auth/gating.ts`) and enforced by `src/proxy.ts`; gated pages also check the user server-side.

### Uploading a scan

`/upload` (sign-in required) takes a `.glb`, `.gltf`, `.ply`, or a `.zip` holding an `.obj` or `.gltf` with its textures, up to 200 MB. It creates a `scans` row (status `uploaded`), then sends the file to Supabase Storage over TUS resumable uploads in 6 MB chunks at `uploads/{user_id}/{scan_id}/raw/source.<ext>`. The original filename is never stored. A dropped connection retries with backoff, and reloading the page and picking the same file resumes from the last chunk. Code: `src/lib/upload/`, `src/app/upload/`.

**File size depends on where Supabase runs.** The local stack (`supabase start`) and self-hosted setups use the 200 MiB limit in `supabase/config.toml`. **The hosted Supabase Free plan caps every file at 50 MB, and that cap can't be raised** ([file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)). On a hosted Free project, uploads over 50 MB pass the page's 200 MB check and are then rejected by Storage, and the page says so. Pro and above allow up to 500 GB per file, configured in the dashboard. This is accepted for development ([ADR 002](docs/decisions/002-mesh-storage.md) D2).

## Stack

Next.js (App Router, TypeScript) · three.js via react-three-fiber · Supabase (Postgres + Auth + Storage + Edge Functions) · [OpenBeta](https://openbeta.io) GraphQL API for climbing metadata · Vercel.

## Values

Open by default · respect climbing access (sensitive areas stay hidden/fuzzed) · community over moderators · don't duplicate open data — build on OpenBeta · contributor-friendly (free-tier self-host in <10 min). Details in [docs/PRD.md §2](docs/PRD.md).

## Contributing

Humans and AI agents both welcome — this repo is set up for parallel agent development (see [PLAN.md §2](PLAN.md) and [CLAUDE.md](CLAUDE.md)). Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

- **Code:** [AGPL-3.0](LICENSE)
- **Contributed scans & climb data:** [CC BY-SA 4.0](DATA_LICENSE.md) — by uploading, contributors agree to share their scans and annotations under this license.
