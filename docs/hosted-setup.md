# Hosted setup checklist

What only the project owner or an admin can do to run SandBag on hosted Supabase and Vercel. **Nothing here has been done, and no agent should do it without the owner.** As of 2026-11-12 the app has only run on a local stack (see [PRD §13](PRD.md)).

Sources are the repo files named in each step; if one of them changes, fix this page.

## 1. Database

- [x] Link the hosted project and run every migration (the first hosted attempt on 2026-11-16 found only 2 of 17 applied, and uploads failed with a "couldn't queue your scan" message; preview with `supabase db push --dry-run`), **through `20261113000300_scan_scale.sql`** (`supabase db push`, or `supabase migration up --linked`). Check `supabase migration list` shows nothing pending.
- [ ] Never run `supabase db reset` against hosted.

## 2. Storage buckets

`supabase/config.toml` configures the **local** stack only. Hosted buckets keep whatever the dashboard says.

- [ ] `uploads` allows `image/webp` (the QC worker writes `derived/thumb.webp`; without it thumbnails silently never exist, see the comment in `supabase/config.toml`). Dashboard: Storage > `uploads` > edit > allowed MIME types.
- [ ] Bucket allow-lists and privacy match `supabase/config.toml`: `uploads` private; `published` public read; `originals` private.
- [ ] Hosted Free caps every file at 50 MB and that can't be raised ([README](../README.md), ADR 002 D2). Larger scans need a paid plan, or users get a clear error at upload.

## 3. QC worker (the scan checker runs on a schedule)

The app's route `POST /api/qc/run` is called every minute by `pg_cron` (`supabase/README.md` "QC job queue"). It does nothing until both halves exist:

- [x] App env var `QC_RUN_SECRET` (at least 32 characters; generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).
- [x] Supabase Vault secret `qc_run_secret` with the **same** value.
- [x] Vault secret `qc_run_url`: the deployed URL of `/api/qc/run`.
- [x] `pg_cron` and `pg_net` are available on the project (the migration runs `create extension` for both; on hosted it fails if the plan or project does not allow them).

Without them, uploads sit in `uploaded` forever. Never put these values in a migration.

## 4. App environment (Vercel)

From `.env.example`; none of the secrets may get a `NEXT_PUBLIC_` prefix.

- [x] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [x] `SUPABASE_SERVICE_ROLE_KEY` (server only)
- [x] `QC_RUN_SECRET` (step 3)
- [ ] `LOCATION_FUZZ_SECRET` (at least 32 characters; set once and keep it: rotating it moves every fuzzed point, and old and new points together narrow down the real location). Missing or short, fuzzed areas are served as hidden.
- [x] Auth providers and redirect URLs configured in the Supabase dashboard (`.env.example`, OAuth section).
- [ ] The function timeout allows the QC route (`maxDuration` 300 in `src/app/api/qc/run/route.ts`; check the Vercel plan allows it) and enough memory: about 1.1 GB at 5M triangles (comment in the same file).

## Making yourself a maintainer

Reviewing needs `reviewer` or higher (`public.trust_level`: `contributor` default, `reviewer`, `maintainer`). Nothing in the app grants it; the owner does it once in the Supabase SQL editor, after the migrations are applied and after signing in so the profile exists:

```sql
update public.profiles set trust_level = 'maintainer' where handle = '<your handle>';
select handle, trust_level from public.profiles;
```

Self-review is refused, so approving a scan needs a second account.

## Sign-in (GitHub and Google)

Verified working on the hosted site on 2026-11-16. What it took, so it is not rediscovered:

- Supabase **Site URL** is the bare origin (`https://<site>`). Putting the redirect pattern (`.../auth/callback**`) in that field is invalid. The pattern belongs in **Redirect URLs**.
- The OAuth apps' callback is the **Supabase** one, `https://<project-ref>.supabase.co/auth/v1/callback`. Google failed with `redirect_uri_mismatch` until it was added to the client's Authorized redirect URIs.
- Google's consent screen must be **External**. **Internal** returns `403 org_internal` for any account outside the Google Workspace org.
- In Testing mode only listed **test users** can sign in with Google. Add testers under Audience, or publish the screen (a separate decision; it makes sign-in public).
- An OAuth app's JavaScript origin is not needed for this flow.

## 5. Weekly dataset export (GitHub)

- [ ] Repository **variables** (not secrets) `SUPABASE_URL` and `SUPABASE_ANON_KEY` ([`dataset-export.yml`](../.github/workflows/dataset-export.yml)). Without them the workflow reports "skipped". The anon key only: never the service role key.

## 6. Smoke test after setup

Only after everything above, with the owner watching:

- [x] `/api/health` no longer reports `"supabase": "unconfigured"`.
- [x] Sign in, upload a small scan, and watch it reach `pending_review` within a few minutes (this proves steps 2 and 3).
- [x] The scan has a thumbnail (proves `image/webp`). Confirmed by the owner on 2026-11-16.
- [x] A reviewer approves it (not the uploader; self-review is refused), and the published page loads the mesh.
- [x] Annotate and save a climb.

Result recorded in PRD §13 (2026-11-16: loop verified, thumbnail confirmed). Record any later change in PRD §13: "hosted" is not verified until this passes.
