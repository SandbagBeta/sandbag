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
 * Runs the seed. Uploads the GLB when Supabase credentials are present,
 * otherwise reports what it would do. Never inserts rows: the schema is issue
 * #3 and has not landed.
 *
 * @param {object} opts
 * @param {Record<string, string|undefined>} opts.env
 * @param {(url: string, key: string) => any} opts.createClient  supabase-js factory (injectable for tests)
 * @param {(msg: string) => void} [opts.log]
 * @param {typeof DEFAULT_PATHS} [opts.paths]
 * @param {boolean} [opts.force]  allow a non-local NEXT_PUBLIC_SUPABASE_URL (`pnpm seed --force`)
 * @returns {Promise<{ uploaded: boolean, hash: string }>}
 */
export async function runSeed({
  env,
  createClient,
  log = console.log,
  paths = DEFAULT_PATHS,
  force = false,
}) {
  const info = await validateFixtures(paths);
  log(
    `fixtures ok: demo-boulder.glb ${(info.bytes / 1024).toFixed(0)} KB, ${info.triCount} tris, sha256 ${info.hash.slice(0, 12)}…; ${info.climbs} climbs, ${info.holds} holds, ${info.paths} paths`,
  );
  log(
    "DB rows: skipped — schema v1 (issue #3) has not landed, nothing to insert yet.",
  );

  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    log(
      `storage: skipped — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to upload to bucket "${STORAGE_BUCKET}" at ${STORAGE_PATH}.`,
    );
    return { uploaded: false, hash: info.hash };
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
  return { uploaded: true, hash: info.hash };
}
