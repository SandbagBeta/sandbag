// Seed logic, kept free of process.exit/argv so tests can drive it with a
// mocked Supabase client. scripts/seed.mjs is the thin CLI wrapper.
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MAX_FIXTURE_BYTES, readGLB } from "./glb.mjs";
import { sha256 } from "../generate-demo-boulder.mjs";

const root = new URL("../../", import.meta.url);
export const DEFAULT_PATHS = Object.freeze({
  glb: fileURLToPath(new URL("public/fixtures/demo-boulder.glb", root)),
  holds: fileURLToPath(new URL("src/lib/fixtures/demo-boulder.json", root)),
});

/** Storage destination — bucket `published` (public read) is declared by issue #2. */
export const STORAGE_BUCKET = "published";
export const STORAGE_PATH = "demo/demo-boulder.glb";

/** True when the Supabase URL points at a local stack (`supabase start`). */
export function isLocalSupabaseUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Validates the committed fixtures and returns what the seed needs from them.
 * Throws a plain-English error on the first problem.
 */
export async function validateFixtures(paths = DEFAULT_PATHS) {
  const glb = await readFile(paths.glb).catch(() => {
    throw new Error(`missing ${paths.glb} — run \`pnpm fixtures:generate\``);
  });
  if (glb.byteLength > MAX_FIXTURE_BYTES) {
    throw new Error(
      `${paths.glb} is ${(glb.byteLength / 1048576).toFixed(1)} MB; fixtures must stay under 10 MB`,
    );
  }
  const mesh = await readGLB(glb).catch((err) => {
    throw new Error(`${paths.glb} does not parse as GLB: ${err.message}`);
  });
  const fixture = JSON.parse(await readFile(paths.holds, "utf8"));
  const hash = sha256(glb);
  if (fixture.scan?.content_hash !== hash) {
    throw new Error(
      `fixture content_hash ${fixture.scan?.content_hash} does not match GLB sha256 ${hash} — run \`pnpm fixtures:generate\` and commit both files`,
    );
  }
  const stale = fixture.holds.filter((h) => h.scan_content_hash !== hash);
  if (stale.length) {
    throw new Error(
      `${stale.length} hold(s) reference a different scan_content_hash — regenerate the fixture`,
    );
  }
  return {
    fixture,
    glb,
    hash,
    triCount: mesh.triCount,
    bytes: glb.byteLength,
    climbs: fixture.climbs.length,
    holds: fixture.holds.length,
    paths: fixture.paths.length,
    mtime: (await stat(paths.glb)).mtime,
  };
}

/**
 * Maps the fixture JSON onto schema v1 rows (supabase/migrations/*_schema_v1.sql).
 *
 * - Lifecycle columns are left out on purpose. New rows start at the column
 *   defaults and are moved to published by the lifecycle module (#20), the
 *   only code allowed to write them (CLAUDE.md "state machine discipline").
 * - Author columns are null: the fixture's uploader/creator id has no profile
 *   (profiles reference auth.users). The schema allows null authors; it is
 *   how deleted accounts are anonymized, and it fits synthetic demo data.
 * - `public_url` is a fixture convenience for the viewer, not a column.
 */
export function fixtureRows(fixture) {
  const { public_url: _publicUrl, ...scan } = withoutLifecycle(fixture.scan);
  return {
    scan: { ...scan, uploader_id: null },
    climbs: fixture.climbs.map((climb) => ({
      ...withoutLifecycle(climb),
      created_by: null,
    })),
    holds: fixture.holds,
    paths: fixture.paths,
  };
}

function withoutLifecycle(row) {
  const { status: _status, ...rest } = row;
  return rest;
}

/** Lifecycle route from a new row to published, per src/lib/lifecycle/transitions.ts. */
export const PUBLISH_ROUTE = Object.freeze({
  scan: ["uploaded", "processing", "pending_review", "published"],
  climb: ["pending_review", "published"],
});

/**
 * Upserts the fixture rows (idempotent: keyed on the fixture's fixed ids) in
 * foreign-key order. The rows carry no lifecycle column, so a re-run keeps
 * whatever lifecycle state they already reached.
 */
async function upsertRows(supabase, rows) {
  const write = async (table, data) => {
    const { error } = await supabase
      .from(table)
      .upsert(data, { onConflict: "id" });
    if (error) throw new Error(`upsert into ${table} failed: ${error.message}`);
  };
  await write("scans", [rows.scan]);
  await write("climbs", rows.climbs);
  await write("holds", rows.holds);
  await write("paths", rows.paths);
}

/**
 * Walks each row along PUBLISH_ROUTE from wherever it is now, one lifecycle
 * transition at a time. Rows already published are left alone.
 */
async function publishRows(supabase, applyTransition, kind, table, ids, log) {
  const { data, error } = await supabase
    .from(table)
    .select("id, status")
    .in("id", ids);
  if (error) throw new Error(`reading ${table} failed: ${error.message}`);
  const route = PUBLISH_ROUTE[kind];
  let moved = 0;
  for (const row of data) {
    const current = row.status;
    const at = route.indexOf(current);
    if (at === -1) {
      throw new Error(
        `demo ${kind} ${row.id} is ${current}, which cannot reach published. ` +
          "Reset the local database with `npx supabase db reset`, then re-run `pnpm seed`.",
      );
    }
    for (let i = at; i < route.length - 1; i++) {
      await applyTransition(supabase, {
        kind,
        id: row.id,
        from: route[i],
        to: route[i + 1],
      });
    }
    if (at < route.length - 1) {
      moved++;
      log(`lifecycle: ${kind} ${row.id} ${route.slice(at).join(" → ")}`);
    }
  }
  return moved;
}

/**
 * Runs the seed: uploads the GLB, upserts the demo scan, climbs, holds and
 * paths, then publishes the scan and climbs through the lifecycle module.
 * Without Supabase credentials it reports what it would do and does nothing.
 *
 * @param {object} opts
 * @param {Record<string, string|undefined>} opts.env
 * @param {(url: string, key: string) => any} opts.createClient  supabase-js factory (injectable for tests)
 * @param {(db: any, req: { kind: "scan"|"climb", id: string, from: string, to: string }) => Promise<void>} [opts.applyTransition]
 *   src/lib/lifecycle applyTransition (injectable for tests); required when credentials are set
 * @param {(msg: string) => void} [opts.log]
 * @param {typeof DEFAULT_PATHS} [opts.paths]
 * @param {boolean} [opts.force]  allow a non-local NEXT_PUBLIC_SUPABASE_URL (`pnpm seed --force`)
 * @returns {Promise<{ uploaded: boolean, hash: string, published: number }>}
 */
export async function runSeed({
  env,
  createClient,
  applyTransition,
  log = console.log,
  paths = DEFAULT_PATHS,
  force = false,
}) {
  const info = await validateFixtures(paths);
  log(
    `fixtures ok: demo-boulder.glb ${(info.bytes / 1024).toFixed(0)} KB, ${info.triCount} tris, sha256 ${info.hash.slice(0, 12)}…; ${info.climbs} climbs, ${info.holds} holds, ${info.paths} paths`,
  );

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    log(
      `storage + DB rows: skipped — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to upload to bucket "${STORAGE_BUCKET}" at ${STORAGE_PATH} and insert the demo rows.`,
    );
    return { uploaded: false, hash: info.hash, published: 0 };
  }
  if (typeof applyTransition !== "function") {
    throw new Error(
      "runSeed needs applyTransition from src/lib/lifecycle to publish the demo rows",
    );
  }
  if (!force && !isLocalSupabaseUrl(url)) {
    throw new Error(
      `refusing to upload: NEXT_PUBLIC_SUPABASE_URL (${url}) is not a local stack (localhost or 127.0.0.1). ` +
        `This script uses the service-role key, which bypasses RLS. If you really mean to seed a remote project, run \`pnpm seed --force\`.`,
    );
  }

  const supabase = createClient(url, key);
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(STORAGE_PATH, info.glb, {
      contentType: "model/gltf-binary",
      upsert: true,
    });
  if (error) {
    throw new Error(
      `upload to ${STORAGE_BUCKET}/${STORAGE_PATH} failed: ${error.message}`,
    );
  }
  log(`storage: uploaded ${STORAGE_BUCKET}/${STORAGE_PATH} to ${url}`);

  const rows = fixtureRows(info.fixture);
  await upsertRows(supabase, rows);
  log(
    `db: upserted 1 scan, ${rows.climbs.length} climbs, ${rows.holds.length} holds, ${rows.paths.length} paths`,
  );
  // Scan first: published climbs on an unpublished scan stay invisible (RLS).
  const published =
    (await publishRows(
      supabase,
      applyTransition,
      "scan",
      "scans",
      [rows.scan.id],
      log,
    )) +
    (await publishRows(
      supabase,
      applyTransition,
      "climb",
      "climbs",
      rows.climbs.map((c) => c.id),
      log,
    ));
  if (published === 0) log("lifecycle: demo rows already published");
  return { uploaded: true, hash: info.hash, published };
}
