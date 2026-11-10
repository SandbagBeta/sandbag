#!/usr/bin/env node
// Generates the demo boulder fixture: public/fixtures/demo-boulder.glb plus
// src/lib/fixtures/demo-boulder.json (scan metadata, two climbs, holds, paths).
// Deterministic: same code → byte-identical GLB → same content hash.
// Usage: pnpm fixtures:generate
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import { generateBoulder } from "./lib/boulder-geometry.mjs";
import { buildGLB, MAX_FIXTURE_BYTES, readGLB } from "./lib/glb.mjs";
import { nearestSurfacePoint } from "./lib/mesh-surface.mjs";

const root = new URL("../", import.meta.url);
export const GLB_PATH = fileURLToPath(
  new URL("public/fixtures/demo-boulder.glb", root),
);
export const HOLDS_PATH = fileURLToPath(
  new URL("src/lib/fixtures/demo-boulder.json", root),
);

const SCAN_ID = "00000000-0000-4000-8000-00000000a001";
const UPLOADER_ID = "00000000-0000-4000-8000-0000000000e0";
const id = (prefix, n) =>
  `00000000-0000-4000-8000-0000${prefix}${String(n).padStart(6, "0")}`;

// Rough targets in meters (x, y, z); each is snapped to the nearest mesh face.
// Climb 1 goes up the front (+z) face, climb 2 up the left (-x) shoulder, and
// both top out over the summit and downclimb the back/right side.
const CLIMBS = [
  {
    id: id("0c", 1),
    name: "Demo Arete",
    description:
      "Procedural placeholder climb up the front face. Exists so the viewer has something to render.",
    proposed_grade: "V2",
    fa_info: "Synthetic — no first ascent.",
    holds: [
      ["start", [-0.3, 0.7, 0.9]],
      ["start", [0.1, 0.65, 0.9]],
      ["foot", [-0.2, 0.25, 0.95]],
      ["foot", [0.25, 0.3, 0.95]],
      ["hand", [-0.1, 1.1, 0.75]],
      ["hand", [0.3, 1.35, 0.6]],
      ["finish", [0.1, 1.7, 0.3]],
    ],
    topout: [
      [0.1, 1.7, 0.3],
      [0, 1.85, 0],
      [0, 1.75, -0.4],
    ],
    downclimb: [
      [0.3, 1.4, -0.7],
      [0.4, 0.9, -0.85],
      [0.4, 0.3, -0.9],
    ],
  },
  {
    id: id("0c", 2),
    name: "Sandbagged Slab",
    description:
      "Procedural placeholder climb up the left shoulder. Distinct hold set from Demo Arete.",
    proposed_grade: "V4",
    fa_info: "Synthetic — no first ascent.",
    holds: [
      ["start", [-1.15, 0.6, 0.2]],
      ["foot", [-1.2, 0.2, 0]],
      ["foot", [-1.1, 0.3, 0.4]],
      ["hand", [-1.0, 1.1, 0.1]],
      ["hand", [-0.8, 1.4, -0.2]],
      ["hand", [-0.5, 1.6, 0.1]],
      ["finish", [-0.3, 1.78, 0]],
    ],
    topout: [
      [-0.3, 1.78, 0],
      [0, 1.85, 0],
      [0.5, 1.6, 0],
    ],
    downclimb: [
      [1.0, 1.1, -0.2],
      [1.2, 0.5, 0],
      [1.2, 0.15, 0.1],
    ],
  },
];

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Builds the fixture JSON from the decoded canonical GLB geometry. */
export function buildFixtureData(geometry, contentHash) {
  const holds = [];
  const paths = [];
  const climbs = [];
  let holdN = 0,
    pathN = 0;
  const snap = (target) => nearestSurfacePoint(geometry, target);

  for (const c of CLIMBS) {
    climbs.push({
      id: c.id,
      scan_id: SCAN_ID,
      name: c.name,
      description: c.description,
      proposed_grade: c.proposed_grade,
      fa_info: c.fa_info,
      status: "published",
      created_by: UPLOADER_ID,
    });
    const linePoints = [];
    c.holds.forEach(([type, target], seq) => {
      const anchor = snap(target);
      holds.push({
        id: id("0d", ++holdN),
        climb_id: c.id,
        scan_content_hash: contentHash,
        ...anchor,
        type,
        seq_order: seq,
      });
      if (type !== "foot") linePoints.push(anchor.position);
    });
    for (const [kind, points] of [
      ["line", linePoints],
      ["topout", c.topout.map((t) => snap(t).position)],
      ["downclimb", c.downclimb.map((t) => snap(t).position)],
    ]) {
      paths.push({ id: id("0e", ++pathN), climb_id: c.id, kind, points });
    }
  }

  return {
    scan: {
      id: SCAN_ID,
      uploader_id: UPLOADER_ID,
      status: "published",
      glb_path: "demo/demo-boulder.glb",
      public_url: "/fixtures/demo-boulder.glb",
      content_hash: contentHash,
      tri_count: geometry.triCount,
      texture_res: null,
      capture_app: "procedural",
      license: "CC-BY-SA-4.0",
    },
    climbs,
    holds,
    paths,
  };
}

export async function generate({ log = console.log } = {}) {
  const t0 = performance.now();
  const glb = await buildGLB(generateBoulder(), { name: "demo-boulder" });
  if (glb.byteLength > MAX_FIXTURE_BYTES) {
    throw new Error(`GLB is ${glb.byteLength} bytes; fixture limit is 10 MB`);
  }
  const hash = sha256(glb);
  const geometry = await readGLB(glb); // sample holds on the *canonical* mesh
  const data = buildFixtureData(geometry, hash);

  await mkdir(new URL("public/fixtures/", root), { recursive: true });
  await writeFile(GLB_PATH, glb);
  const json = await prettier.format(JSON.stringify(data), {
    ...(await prettier.resolveConfig(HOLDS_PATH)),
    parser: "json",
  });
  await writeFile(HOLDS_PATH, json);

  const b = geometry.bounds;
  const size = b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join(" x ");
  log(`wrote ${GLB_PATH}`);
  log(
    `  ${(glb.byteLength / 1024).toFixed(0)} KB, ${geometry.triCount} tris, ${geometry.vertexCount} verts, ${size} m`,
  );
  log(`  sha256 ${hash}`);
  log(
    `wrote ${HOLDS_PATH} (${data.climbs.length} climbs, ${data.holds.length} holds, ${data.paths.length} paths)`,
  );
  log(
    `  ${(performance.now() - t0).toFixed(0)} ms, peak RSS ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`,
  );
  return { glb, hash, data };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generate().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
