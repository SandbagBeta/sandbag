# End-to-end tests

Playwright specs live in `e2e/`. One suite, two targets.

## Locally

```bash
pnpm exec playwright install chromium   # once
supabase start && pnpm seed             # database-backed specs need this
# put NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
# SUPABASE_SERVICE_ROLE_KEY in your shell (or .env.local and `set -a; . .env.local`)
pnpm e2e                                # starts `pnpm dev` itself
```

Without the three Supabase variables the database-backed specs skip and the `@smoke` specs still run.

## Against a deployed URL (no custom domain needed)

```bash
BASE_URL=https://<your-deployment>.vercel.app pnpm e2e:smoke
```

`@smoke` specs need no secrets and write nothing. Do not point the full suite at a hosted project: it creates and deletes users with the service-role key.

## How tests sign in

Sign-in is GitHub/Google OAuth only, which a test can't drive. `e2e/support/auth.ts` creates a throwaway user with the Supabase admin API, mints a magic-link token, exchanges it for a session and writes the `@supabase/ssr` cookie. There is no test hook in the app and no extra login path in production. It needs the service-role key, so only run it against a database you own.

## Writing specs

- Tag specs that are safe on a deployed site `@smoke`.
- Anything that can show a location must assert no coordinates leak (`e2e/privacy.spec.ts`).
- Planned next: upload -> QC (call `POST /api/qc/run` with `QC_RUN_SECRET`) -> review -> publish -> annotate -> grade vote -> export.

## In CI

- `e2e` job in `.github/workflows/ci.yml`: starts a local Supabase stack, seeds, builds, serves the production bundle (`E2E_SERVER=start`) and runs the full suite. Failure uploads the Playwright report and traces. It is not a required check yet (#150).
- `.github/workflows/smoke.yml`: on a successful deployment, runs `@smoke` against the deployment URL. If previews use Vercel Deployment Protection, add the repository secret `VERCEL_AUTOMATION_BYPASS_SECRET` (Vercel: Project Settings > Deployment Protection > Protection Bypass for Automation).

## Troubleshooting

- **Viewer spec times out, page text looks fine:** Next 16 serves no client JS to hosts missing from `allowedDevOrigins`. The config passes `DEV_ALLOWED_ORIGINS` for the test host; if you change `BASE_URL` for a local dev server, the same applies.
