// @vitest-environment node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { UploadKind } from "../upload/validate";
import type { CheckId } from "./checks";
import { formatMetrics } from "./metrics";
import { runQcChecks } from "./run";

/**
 * Golden set (ADR 003 §7): 5 good scans pass, 8 crafted bad files fail with
 * the named reason. Every check id appears in at least one pass and one
 * fail case (lane guide). Fixtures come from scripts/generate-qc-fixtures.mjs.
 */
const DIR = fileURLToPath(new URL("../../../fixtures/qc/", import.meta.url));
const read = (name: string) => new Uint8Array(readFileSync(DIR + name));
const kindOf = (name: string) => name.split(".").pop() as UploadKind;

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function run(name: string) {
  const result = await runQcChecks({ bytes: read(name), kind: kindOf(name) });
  console.info(`${name}: ${formatMetrics(result.metrics)}`);
  return result;
}

const failing = (r: Awaited<ReturnType<typeof run>>) =>
  r.report.checks.filter((c) => !c.pass);

describe("golden set: good scans pass to review", () => {
  it.each([
    ["good-polycam-like.glb", []],
    ["good-scaniverse-like.ply", []],
    ["good-obj.zip", ["texture_res", "floaters"]],
    ["good-draco.glb", []],
    ["good-georeferenced.zip", []],
  ] as [string, CheckId[]][])("%s", async (name, warnings) => {
    const r = await run(name);
    expect(r.passed).toBe(true);
    const soft = failing(r);
    expect(soft.map((c) => c.id).sort()).toEqual([...warnings].sort());
    expect(soft.every((c) => c.severity === "warning")).toBe(true);
    expect(r.triCount).toBeGreaterThanOrEqual(10_000);
    expect(r.report.extents_m).not.toBeNull();
  });

  it("vertex colours count as colour and skip the texture check (O6)", async () => {
    const r = await run("good-scaniverse-like.ply");
    const ids = r.report.checks.map((c) => c.id);
    expect(ids).toContain("color");
    expect(ids).not.toContain("texture_res");
    expect(r.textureRes).toBeNull();
  });

  it("reads the polycam-like texture size and welds across its UV seams", async () => {
    const r = await run("good-polycam-like.glb");
    expect(r.textureRes).toBe(2048);
    expect(r.stats?.floaterFraction).toBe(0);
    expect(r.stats?.boundaryEdges).toBe(0);
  });
});

describe("golden set: bad files fail with the named reason", () => {
  it.each([
    [
      "bad-magic.glb",
      "file_type",
      /isn't a GLB \(it looks like a JPEG image\)/,
    ],
    ["bad-truncated.glb", "parse", /incomplete or damaged/],
    [
      "bad-too-few-tris.ply",
      "tri_count",
      /^Only 2,028 triangles; we need at least 10,000/,
    ],
    [
      "bad-scale-mm.glb",
      "scale",
      /m across\. It was probably exported in millimetres/,
    ],
    ["bad-flat.ply", "volume", /flat \(no volume\)/],
    [
      "bad-floaters.glb",
      "floaters",
      /^60% of the mesh is disconnected floating pieces\. Crop/,
    ],
    [
      "bad-small-texture.glb",
      "texture_res",
      /^The texture is 512 px; we need at least 1,024 px/,
    ],
    [
      "bad-too-many-tris.ply",
      "too_large",
      /too large: 6M triangles; the limit is 5M/,
    ],
  ] as [string, CheckId, RegExp][])(
    "%s fails %s",
    async (name, id, message) => {
      const r = await run(name);
      expect(r.passed).toBe(false);
      const hard = failing(r).filter((c) => c.severity === "error");
      // Exactly the named reason: each fixture is built to break one rule.
      expect(hard.map((c) => c.id)).toEqual([id]);
      expect(hard[0]!.message).toMatch(message);
    },
  );

  it("fails the 6M-face header before parsing anything (H3, O16)", async () => {
    const r = await run("bad-too-many-tris.ply");
    expect(r.report.checks.map((c) => c.id)).toEqual([
      "file_type",
      "file_size",
      "too_large",
    ]);
    expect(r.mesh).toBeNull();
    expect(r.metrics.stages.map((s) => s.stage)).not.toContain("parse");
  });
});

describe("golden set: coverage and privacy", () => {
  it("every check has a passing and a failing fixture", async () => {
    const names = readdirSync(DIR).filter((n) => /^(good|bad)-/.test(n));
    const passed = new Set<string>();
    const failed = new Set<string>();
    for (const name of names) {
      for (const c of (await run(name)).report.checks) {
        (c.pass ? passed : failed).add(c.id);
      }
    }
    // mesh_quality (S4) and the scale warning (S3) are unit-tested on
    // in-memory meshes instead (ADR 003 §7); file_size needs a 200 MB file.
    const all: CheckId[] = [
      "file_type",
      "too_large",
      "parse",
      "tri_count",
      "scale",
      "volume",
      "floaters",
      "texture_res",
    ];
    for (const id of all) {
      expect(passed, `${id} has a pass`).toContain(id);
      expect(failed, `${id} has a fail`).toContain(id);
    }
    expect(passed).toContain("color");
    expect(passed).toContain("mesh_quality");
    expect(passed).toContain("file_size");
  });

  it("the georeferenced scan's report carries no location (G5, O10)", async () => {
    const r = await run("good-georeferenced.zip");
    // Tripwire (ADR 003 §5): the OBJ's offsets were +500,000 / +1,500 /
    // +4,600,000, so no measured number may be anywhere near that size.
    // Thresholds (limit_*, warn_*) are constants and `bytes` is the size.
    const measured = [
      ...Object.values(r.report.extents_m!),
      ...r.report.checks.flatMap((c) =>
        Object.entries(c.data ?? {})
          .filter(([k]) => !/^(limit|warn)_|^bytes$/.test(k))
          .map(([, v]) => Number(v)),
      ),
    ];
    expect(measured.length).toBeGreaterThan(10);
    expect(measured.every((n) => Math.abs(n) < 100_000)).toBe(true);
    const json = JSON.stringify(r.report);
    expect(json).not.toMatch(/\b(500000|4600000|1500)(\.\d+)?\b|4\.6e|5e\+?5/i);
    // Same extents as the un-offset boulder in good-draco.glb.
    const plain = await run("good-draco.glb");
    for (const k of ["width", "height", "depth"] as const) {
      expect(r.report.extents_m![k]).toBeCloseTo(plain.report.extents_m![k], 2);
    }
    // Parsed positions are local (precision kept despite the offsets).
    expect(Math.max(...r.mesh!.positions.map(Math.abs))).toBeLessThan(5);
  });
});

describe("golden set: fixtures match the generator", () => {
  it.each(["UTC", "America/New_York", "Asia/Kathmandu"])(
    "regenerates byte-identical files in %s",
    (tz) => {
      const generator = new URL(
        "../../../scripts/generate-qc-fixtures.mjs",
        import.meta.url,
      ).href;
      const script = `
        import { createHash } from 'node:crypto';
        const { generateQcFixtures } = await import(${JSON.stringify(generator)});
        const fixtures = await generateQcFixtures();
        console.log(JSON.stringify(Object.fromEntries(
          Object.entries(fixtures).map(([name, bytes]) =>
            [name, createHash('sha256').update(bytes).digest('hex')])
        )));
      `;
      const hashes = JSON.parse(
        execFileSync(
          process.execPath,
          ["--input-type=module", "-e", script, "timezone-check"],
          {
            env: { ...process.env, TZ: tz },
            encoding: "utf8",
            timeout: 60_000,
          },
        ),
      ) as Record<string, string>;
      for (const [name, hash] of Object.entries(hashes)) {
        expect(sha(read(name)), `${tz}: ${name}`).toBe(hash);
      }
    },
    60_000,
  );

  it("regenerates byte-identical files", async () => {
    const { generateQcFixtures } =
      await import("../../../scripts/generate-qc-fixtures.mjs");
    // The .mjs return type is inferred from JS; it is name → bytes.
    const fresh = (await generateQcFixtures()) as unknown as Record<
      string,
      Uint8Array
    >;
    const committed = readdirSync(DIR).filter((n) => /^(good|bad)-/.test(n));
    expect(committed.sort()).toEqual(Object.keys(fresh).sort());
    let total = 0;
    for (const [name, bytes] of Object.entries(fresh)) {
      expect(sha(read(name)), name).toBe(sha(bytes));
      expect(bytes.length, `${name} ≤ 1 MB`).toBeLessThanOrEqual(1024 * 1024);
      total += bytes.length;
    }
    expect(total).toBeLessThanOrEqual(6 * 1024 * 1024);
  }, 60_000);
});
