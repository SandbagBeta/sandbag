import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Climb, ClimbPath, Hold } from "@/lib/types";
import { buildDatasetFiles, type DatasetScanInput } from "./dataset";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const text = (f: { data: Uint8Array } | undefined) =>
  new TextDecoder().decode(f!.data);

const USER = "99999999-9999-4999-8999-999999999999";

function scan(n: number, handle = `user${n}`): DatasetScanInput {
  const glb = new TextEncoder().encode(`glb-${n}`);
  const hash = sha(glb);
  const id = `0000000${n}-0000-4000-8000-000000000000`;
  const climbId = `1000000${n}-0000-4000-8000-000000000000`;
  const climb = {
    id: climbId,
    scan_id: id,
    name: `Climb ${n}`,
    description: "d",
    proposed_grade: "V3",
    fa_info: null,
    status: "published",
    created_by: USER, // must never reach the output
  } as unknown as Climb;
  const hold = {
    id: `2000000${n}-0000-4000-8000-000000000000`,
    climb_id: climbId,
    scan_content_hash: hash,
    position: [1, 2, 3],
    normal: [0, 0, 1],
    face_index: 7,
    type: "start",
    seq_order: 0,
    // Unknown columns (e.g. from a future `select *`) must be dropped.
    extra_column: "must be dropped",
    uploader_id: USER,
  } as unknown as Hold;
  const path = {
    id: `3000000${n}-0000-4000-8000-000000000000`,
    climb_id: climbId,
    kind: "line",
    points: [
      [0, 0, 0],
      [1, 1, 1],
    ],
  } as unknown as ClimbPath;
  return {
    scan: {
      id,
      openbeta_area_id: null,
      openbeta_climb_id: null,
      content_hash: hash,
      tri_count: 100,
      texture_res: 2048,
      capture_app: "Polycam",
      captured_at: null,
      license: "CC-BY-SA-4.0",
    },
    climbs: [climb],
    holds: [hold],
    paths: [path],
    contributors: [{ handle, role: "scan" }],
    glb,
  };
}

const T = "2026-11-12T00:00:00.000Z";

describe("buildDatasetFiles (#33)", () => {
  const files = buildDatasetFiles([scan(2), scan(1)], T);
  const byPath = new Map(files.map((f) => [f.path, f]));

  it("lays out a manifest, per-scan files, flat labels and the licence", () => {
    expect([...byPath.keys()]).toEqual([
      "manifest.json",
      "labels.jsonl",
      "scans/00000001-0000-4000-8000-000000000000/mesh.glb",
      "scans/00000001-0000-4000-8000-000000000000/climbs.json",
      "scans/00000001-0000-4000-8000-000000000000/holds.json",
      "scans/00000001-0000-4000-8000-000000000000/paths.json",
      "scans/00000002-0000-4000-8000-000000000000/mesh.glb",
      "scans/00000002-0000-4000-8000-000000000000/climbs.json",
      "scans/00000002-0000-4000-8000-000000000000/holds.json",
      "scans/00000002-0000-4000-8000-000000000000/paths.json",
      "LICENSE.txt",
      "ATTRIBUTION.txt",
    ]);
    const manifest = JSON.parse(text(byPath.get("manifest.json")));
    expect(manifest).toMatchObject({
      schema_version: 1,
      exported_at: T,
      license: "CC-BY-SA-4.0",
      counts: { scans: 2, climbs: 2, holds: 2 },
    });
    expect(manifest.scans[0]).toMatchObject({
      glb_file: "scans/00000001-0000-4000-8000-000000000000/mesh.glb",
      hold_count: 1,
    });
  });

  it("writes one JSON line per hold, labelled with its scan", () => {
    const lines = text(byPath.get("labels.jsonl")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      scan_id: "00000001-0000-4000-8000-000000000000",
      type: "start",
      position: [1, 2, 3],
      face_index: 7,
    });
  });

  it("drops user ids and unknown columns from every file", () => {
    for (const f of files) {
      if (f.path.endsWith(".glb")) continue;
      const s = text(f);
      expect(s).not.toContain(USER);
      expect(s).not.toMatch(/created_by|uploader|extra_column/);
    }
  });

  it("credits contributor handles only in ATTRIBUTION.txt", () => {
    expect(text(byPath.get("ATTRIBUTION.txt"))).toContain("- user1");
    for (const f of files) {
      if (f.path === "ATTRIBUTION.txt" || f.path.endsWith(".glb")) continue;
      expect(text(f)).not.toContain("user1");
    }
  });

  it("is deterministic: input order doesn't matter", () => {
    const again = buildDatasetFiles([scan(1), scan(2)], T);
    expect(again.map((f) => [f.path, text(f)])).toEqual(
      files.map((f) => [f.path, text(f)]),
    );
  });

  it("refuses data that fails its integrity checks", () => {
    const bad = scan(1);
    bad.glb = new TextEncoder().encode("tampered");
    expect(() => buildDatasetFiles([bad], T)).toThrow(/do not match/);

    const foreign = scan(1);
    foreign.holds[0]!.scan_content_hash = "f".repeat(64);
    expect(() => buildDatasetFiles([foreign], T)).toThrow(/not anchored/);

    const orphan = scan(1);
    orphan.holds[0]!.climb_id = "40000000-0000-4000-8000-000000000000";
    expect(() => buildDatasetFiles([orphan], T)).toThrow(/not anchored/);

    const strayPath = scan(1);
    strayPath.paths[0]!.climb_id = "40000000-0000-4000-8000-000000000000";
    expect(() => buildDatasetFiles([strayPath], T)).toThrow(/does not belong/);

    expect(() => buildDatasetFiles([scan(1), scan(1)], T)).toThrow(/unique/);
  });

  it("exports an empty corpus as a valid, empty dataset", () => {
    const empty = buildDatasetFiles([], T);
    const manifest = JSON.parse(
      text(empty.find((f) => f.path === "manifest.json")),
    );
    expect(manifest.counts).toEqual({ scans: 0, climbs: 0, holds: 0 });
  });
});
