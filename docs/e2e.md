# End-to-end tests

Playwright specs live in `e2e/`. The suite supports a local Supabase stack and a read-only smoke run against a deployed URL.

## Local setup

Install Node.js 24 or newer, pnpm, Docker, and the Supabase CLI. Install Playwright's Chromium browser once:

```bash
pnpm exec playwright install chromium
```

Start the local Supabase stack, seed it, then run the suite. `pnpm e2e` starts `pnpm dev` itself:

```bash
supabase start
pnpm seed
pnpm e2e
```

The database-backed specs need `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the environment. Without them, those specs skip and the `@smoke` specs still run. `pnpm seed` reads the values from `.env.local` when it exists.

### Windows PowerShell

Run these commands from the repository root. The Supabase CLI output names the local values `API_URL`, `ANON_KEY`, and `SERVICE_ROLE_KEY`; `--override-name` maps them to this app's variable names. Copy the three output lines into `.env.local`, keeping any other local settings already in the file:

```powershell
pnpm exec playwright install chromium
supabase start
supabase status -o env `
  --override-name api.url=NEXT_PUBLIC_SUPABASE_URL `
  --override-name auth.anon_key=NEXT_PUBLIC_SUPABASE_ANON_KEY `
  --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY
```

Load `.env.local` into the current PowerShell process, seed the local database, and run the tests:

```powershell
node -e 'process.loadEnvFile(".env.local"); for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) console.log(`${key}=${process.env[key]}`)' |
  ForEach-Object {
    $name, $value = $_ -split "=", 2
    Set-Item "Env:$name" $value
  }
pnpm seed
pnpm e2e
```

PowerShell environment variables use `$env:NAME`. To set one manually, use `$env:NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321"`.

### Windows Command Prompt (cmd.exe)

Run these commands from the repository root. Keep any other local settings already in `.env.local` when adding the three lines printed by `supabase status`:

```bat
pnpm exec playwright install chromium
supabase start
supabase status -o env --override-name api.url=NEXT_PUBLIC_SUPABASE_URL --override-name auth.anon_key=NEXT_PUBLIC_SUPABASE_ANON_KEY --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY
```

After adding those lines to `.env.local`, load them into the current Command Prompt process, seed the local database, and run the tests:

```bat
for /f "tokens=1,* delims==" %A in ('findstr /r /v "^[#;]" .env.local') do @set "%A=%~B"
pnpm seed
pnpm e2e
```

The `for` command expects ordinary dotenv entries (`NAME=value`) and removes surrounding double quotes. At an interactive `cmd.exe` prompt, use `%A`; in a `.bat` file, change it to `%%A`. To set one variable manually, use `set "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321"`.

Use the local stack for the full E2E suite. Do not add `--remote`: that option targets a linked hosted project for specific migration commands, as described in [README troubleshooting](../README.md#troubleshooting). Do not run the full suite against a hosted project; it creates and deletes users using the service-role key.

## Against a deployed URL (no custom domain needed)

`@smoke` specs need no secrets and write nothing. Set `BASE_URL` and run only those specs:

```bash
BASE_URL=https://<your-deployment>.vercel.app pnpm e2e:smoke
```

In PowerShell, set it with `$env:BASE_URL = "https://<your-deployment>.vercel.app"`. In Command Prompt, use `set "BASE_URL=https://<your-deployment>.vercel.app"`.

## How tests sign in

Sign-in is GitHub/Google OAuth, which the test browser cannot drive directly. `e2e/support/auth.ts` creates a throwaway user through the Supabase admin API, mints a magic-link token, exchanges it for a session, and writes the `@supabase/ssr` cookie. It adds no test-only login path to the production app. The service-role key is required, so run the full suite only against a database you own.

## Writing specs

- Tag specs safe to run on a deployed site with `@smoke`.
- Anything that can show a location must assert that coordinates do not leak (`e2e/privacy.spec.ts`).
- The planned next flow is upload → QC (`POST /api/qc/run`, `QC_RUN_SECRET`) → review → publish → annotate → grade vote → export.

## In CI

- The `e2e` job in `.github/workflows/ci.yml` starts the local Supabase stack, seeds it, builds the app, serves the production bundle (`E2E_SERVER=start`), and runs the full suite. It uploads the Playwright report and traces on failure. It is not a required check yet (#150).
- `.github/workflows/smoke.yml` runs `@smoke` against the repository variable `SMOKE_BASE_URL`. It runs after CI passes on `main`, manually from the Actions tab (with an optional `url` input), and in a daily watchdog. If the variable and input are unset, it skips.
- The smoke workflow does not use GitHub deployment events because Vercel does not create GitHub deployments for this repository. If the site uses Vercel Deployment Protection, add the `VERCEL_AUTOMATION_BYPASS_SECRET` repository secret (Vercel: Project Settings → Deployment Protection → Protection Bypass for Automation).
- Next.js 16 also needs `DEV_ALLOWED_ORIGINS` to include the local dev-server host. The Playwright config sets it from `BASE_URL`.

## Troubleshooting

- **The viewer spec times out even though the page text looks fine:** Next.js 16 serves no client JavaScript to hosts missing from `allowedDevOrigins`. The Playwright config sets `DEV_ALLOWED_ORIGINS` from `BASE_URL`; keep the test host and `BASE_URL` in sync.
