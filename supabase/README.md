# supabase/

Migrations (`migrations/`, applied by `supabase start` / `supabase db start`, never edited once merged) and pgTAP tests (`tests/database/`, run with `supabase test db`). CI runs `supabase db start`, `supabase db lint` and `supabase test db`.

## QC job queue

Migration `20261110000300_qc_jobs.sql`, design in [ADR 003](../docs/decisions/003-qc-pipeline-runtime.md) (O2, O3, O8, §5, §6). The QC pipeline runs in Node inside the Next.js app behind a secret-protected route. Jobs live in `private.qc_jobs`. PostgREST doesn't expose that schema, and no API role has privileges on the table. The app uses four functions in `public`, all `security definer`, executable **only by `service_role`** (call them with `supabase.rpc(...)` from server code holding the service-role key):

| Function | Returns | Behaviour |
|---|---|---|
| `enqueue_qc_job(p_scan_id uuid, p_raw_path text)` | one row `(job_id uuid, created boolean)` | Idempotent. Creates a `queued` job (0 attempts) unless the scan already has an active one, which it returns with `created = false` (`raw_path` is not changed). `p_raw_path` is the verified object key in `uploads`, `{uploader_id}/{scan_id}/raw/source.<ext>`. The scan segment must equal `p_scan_id` (check violation `23514` otherwise). Once the previous job is finished, a call creates a fresh job: this is the re-run path. |
| `claim_qc_job(p_lease_seconds int default 360, p_pipeline_version text default null)` | zero or one row `(job_id, scan_id, raw_path, attempt, max_attempts, lease_until, lease_token, exhausted)` | Leases the oldest claimable job with `for update skip locked`, so concurrent workers never get the same job. Claimable means `queued` with `run_after <= now()` and attempts left, or `running` with an expired lease. It sets `attempts + 1` (1-based `attempt`), a new `lease_token` and `lease_until`, and records `pipeline_version`. `exhausted = true` means the last allowed attempt died (lease expired): don't run QC. Move the scan to `failed_qc` through the lifecycle module, then call `fail_qc_job`. `p_lease_seconds` must be 30–3600 (`22023` otherwise). |
| `complete_qc_job(p_job_id uuid, p_lease_token uuid)` | `boolean` | Finishes the job as `done`. Use it whenever QC reached a verdict: a pass, **or a genuine mesh failure** (those never retry). `false` if the token isn't the current lease (re-claimed or already finished): stop without writing. |
| `fail_qc_job(p_job_id uuid, p_lease_token uuid, p_error text, p_retry_after_seconds int default null)` | `text`: `'queued'`, `'failed'` or null | Infrastructure errors only (Storage 5xx, DB timeout, network). With attempts left the job returns to `queued` with `run_after = now() + backoff`: `p_retry_after_seconds` if given (0–86400), otherwise 60 s after attempt 1 and 300 s after attempt 2. With no attempts left it finishes as `failed`, and the app moves the scan to `failed_qc` with the "something went wrong on our side" message. Null means the token isn't the current lease. `p_error` is stored in `last_error`, cut to 500 characters with control characters removed. Never pass file bytes, parser dumps or coordinates. |

Table states: `queued` → `running` → `done` | `failed`, or back to `queued` on a retry. `max_attempts` defaults to 3. A partial unique index allows at most one unfinished job per scan, and finished jobs stay as history. Deleting a scan deletes its jobs. Nothing here writes `scans.status` or any other `scans` column (the one exception is the trigger-maintained `processing_started_at`, below). Status and results go through `src/lib/lifecycle` (`raw_path` is copied to `scans` by the lifecycle patch at `uploaded → processing`).

A worker that outlives its lease is fenced out. The next claim issues a new `lease_token`, and `complete`/`fail` with the old token return `false`/null. The lifecycle compare-and-set stops it from writing the scan.

### Stuck `processing` scans

Migration `20261111000000_scan_processing_started_at.sql` (ADR 003 §6). A scan can be left in `processing` with nothing to finish it: a crash after its job was finished but before the status change, or a scan that reached `processing` with no job row. Expired leases on their own are not "stuck"; the queue re-claims those.

- `scans.processing_started_at timestamptz` is set to `now()` by a `before insert or update` trigger whenever `status` changes to `processing` (`uploaded → processing`, or the `failed_qc → processing` re-run), and cleared when it changes to anything else. A check constraint keeps it set exactly while the scan is `processing`. `authenticated` has no insert/update grant on it; the app never writes it.
- `list_stuck_qc_scans(p_older_than_seconds int default 900)` returns up to 100 rows `(scan_id uuid, processing_started_at timestamptz, has_active_job boolean)`, oldest first. Same pattern as the queue functions: `security definer`, **`service_role` only**. A scan is listed when it has been `processing` for longer than the threshold and has no live job. An active (unfinished) job is live, and keeps its scan off the list, if it is `running` with an unexpired lease, `queued` with `run_after` in the future (retry backoff), or was claimed or failed within the threshold. `has_active_job = true` therefore means an unfinished job exists that the queue has stopped moving. The threshold must be 300–86400 seconds (`22023` otherwise). The function is read-only.
- **The app does the transition.** SQL never writes `scans.status`. The QC route calls `list_stuck_qc_scans()` and moves each scan `processing → failed_qc` through `applyTransition` in `src/lib/lifecycle` with the "something went wrong on our side" message (O8). The lifecycle compare-and-set skips a scan that finished in the meantime. If more than 100 come back, call again after handling them.

### Sweep

`private.qc_sweep()` runs every minute through pg_cron (job `qc-sweep`, scheduled by the migration; `qc-sweep-log-purge` keeps a week of its run history). If any job is claimable, or `list_stuck_qc_scans(900)` returns a row, it sends `POST <qc_run_url>` with body `{"source":"sweep"}` and `Authorization: Bearer <qc_run_secret>` through pg_net. The route then claims jobs with `claim_qc_job` and lists stuck scans with `list_stuck_qc_scans`, so the request carries no ids. The sweep is a silent no-op until both Vault secrets exist and the secret is at least 32 characters. It does not depend on Vercel Cron, which runs once a day on Hobby.

The URL and secret are **never** in a migration. Set them in Vault by name (`qc_run_url`, `qc_run_secret`). The secret must equal the one the app's QC route checks; the implementation PR adds that env var to `.env.example`.

Generate a secret:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Local stack.** pg_net runs inside the Postgres container, so `localhost` is the container itself. Point it at the host's dev server through Docker's host alias. Open Studio (<http://127.0.0.1:54323>) → SQL Editor, or `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`, and run:

```sql
select vault.create_secret('http://host.docker.internal:3000/api/qc/run', 'qc_run_url');
select vault.create_secret('<generated secret>', 'qc_run_secret');
```

On Linux without Docker Desktop, `host.docker.internal` may need `--add-host`. Use the host's bridge IP (often `172.17.0.1`) instead. `supabase db reset` wipes Vault, so re-run the two statements after a reset.

**Hosted Supabase.** Dashboard → Integrations → Vault → *Add new secret*, named `qc_run_url` (e.g. `https://<your-app>/api/qc/run`) and `qc_run_secret`. The same two `vault.create_secret` statements also work in the SQL Editor. If the deployment uses Vercel Deployment Protection, the route needs a bypass, because the sweep can't log in.

**Rotate or change:**

```sql
select vault.update_secret((select id from vault.secrets where name = 'qc_run_secret'), '<new secret>');
```

Update the app's env var at the same time. Requests made in between get 401 and are retried on the next sweep.

**Pause the sweep:** `select cron.unschedule('qc-sweep');`. Re-enable with `select cron.schedule('qc-sweep', '* * * * *', 'select private.qc_sweep()');`. Check runs with `select * from cron.job_run_details order by start_time desc limit 5;`.

**Secret exposure.** pg_net keeps each queued request, headers included (so the bearer secret too), in `net.http_request_queue` until its worker sends it, usually within a second. It keeps responses in `net._http_response` for about 6 hours. pg_net's own install script grants all privileges on both tables to `PUBLIC`. The owner is `supabase_admin`, so a migration running as `postgres` can't revoke that. The anon key still can't reach them: PostgREST serves only the schemas in `[api].schemas` (`public`, `graphql_public`), and `net` is not on the API roles' `search_path`, which pg_graphql reflects. Keep `net` out of the exposed schemas, and have the QC route return a short body with no details. Rotate the secret if a database login role other than the service roles is ever handed out.
