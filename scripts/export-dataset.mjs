#!/usr/bin/env node
// pnpm export:dataset [--out dist/dataset] — writes every published scan, climb,
// hold and path as an open dataset (docs/dataset.md, issue #33).
//
// Reads with the PUBLIC anon key only, so it can export nothing an anonymous
// visitor couldn't already see (RLS decides). It never needs, and must never be
// given, the service-role key. Needs NEXT_PUBLIC_SUPABASE_URL and
// NEXT_PUBLIC_SUPABASE_ANON_KEY (loaded from .env.local if present). Without
// them it reports and exits 0, so a fork's scheduled run doesn't fail.
//
// Run through tsx (see package.json) to import the TypeScript builder.
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDatasetFiles } from "../src/lib/export/dataset";
import { createSupabaseStorage } from "../src/lib/storage/supabase";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const outIdx = process.argv.indexOf("--out");
const outDir = path.resolve(
  outIdx > 0 && process.argv[outIdx + 1]
    ? process.argv[outIdx + 1]
    : "dist/dataset",
);

if (!url || !anonKey) {
  console.log(
    "export:dataset skipped: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
  );
  process.exit(0);
}

const db = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const storage = createSupabaseStorage(db, url);

const PAGE = 1000;
const CHUNK = 100; // ids per `in (...)` filter, to keep request URLs short

/** All rows of a query, paged by id (PostgREST caps a response at 1000 rows). */
async function fetchAll(table, columns, filter = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await filter(db.from(table).select(columns))
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function fetchIn(table, columns, column, ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    rows.push(
      ...(await fetchAll(table, columns, (q) =>
        q.in(column, ids.slice(i, i + CHUNK)),
      )),
    );
  }
  return rows;
}

async function main() {
  const scanRows = await fetchAll(
    "scans",
    "id, openbeta_area_id, openbeta_climb_id, content_hash, tri_count, texture_res, scale_factor, capture_app, captured_at, license, glb_path, uploader_id",
    (q) => q.eq("status", "published"),
  );
  const scans = scanRows.filter((s) => {
    const ok = s.glb_path && s.content_hash;
    if (!ok) console.warn(`skipping scan ${s.id}: no canonical mesh`);
    return ok;
  });
  const scanIds = scans.map((s) => s.id);

  const climbRows = (
    await fetchIn(
      "climbs",
      "id, scan_id, name, description, proposed_grade, fa_info, status, created_by",
      "scan_id",
      scanIds,
    )
  ).filter((c) => c.status === "published");
  const climbIds = climbRows.map((c) => c.id);
  const holds = await fetchIn(
    "holds",
    "id, climb_id, scan_content_hash, position, normal, face_index, type, seq_order",
    "climb_id",
    climbIds,
  );
  const paths = await fetchIn(
    "paths",
    "id, climb_id, kind, points",
    "climb_id",
    climbIds,
  );

  const userIds = [
    ...new Set([
      ...scans.map((s) => s.uploader_id),
      ...climbRows.map((c) => c.created_by),
    ]),
  ].filter(Boolean);
  const profiles = await fetchIn("profiles", "id, handle", "id", userIds);
  const handle = new Map(profiles.map((p) => [p.id, p.handle]));

  const inputs = [];
  for (const s of scans) {
    let glb;
    try {
      glb = await storage.download({ bucket: "published", key: s.glb_path });
    } catch {
      throw new Error(`mesh for scan ${s.id}: download failed`);
    }
    const sClimbs = climbRows.filter((c) => c.scan_id === s.id);
    const ids = new Set(sClimbs.map((c) => c.id));
    const contributors = [
      ...(handle.has(s.uploader_id)
        ? [{ handle: handle.get(s.uploader_id), role: "scan" }]
        : []),
      ...sClimbs.flatMap((c) =>
        handle.has(c.created_by)
          ? [{ handle: handle.get(c.created_by), role: "climb" }]
          : [],
      ),
    ];
    inputs.push({
      scan: s,
      climbs: sClimbs,
      holds: holds.filter((h) => ids.has(h.climb_id)),
      paths: paths.filter((p) => ids.has(p.climb_id)),
      contributors,
      glb,
    });
  }

  const files = buildDatasetFiles(inputs, new Date().toISOString());
  for (const f of files) {
    const target = path.join(outDir, f.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, f.data);
  }
  console.log(
    `export:dataset wrote ${scans.length} scans, ${climbRows.length} climbs, ${holds.length} holds to ${outDir}`,
  );
}

main().catch((err) => {
  console.error(`export:dataset failed: ${err.message}`);
  process.exit(1);
});
