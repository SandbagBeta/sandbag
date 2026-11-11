import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildBoulderExport, parseBoulderExport } from "./boulder";
import { readZip } from "./zip";

const glb = new Uint8Array([103, 108, 84, 70, 1, 2, 3, 4]);
const hash = createHash("sha256").update(glb).digest("hex");
const climb = {
  id: "c1",
  scan_id: "s1",
  name: "Warmup",
  description: "",
  proposed_grade: "V2",
  fa_info: null,
  status: "published" as const,
  created_by: null,
};
const hold = {
  id: "h1",
  climb_id: "c1",
  scan_content_hash: hash,
  position: [0, 1, 2] as [number, number, number],
  normal: [0, 1, 0] as [number, number, number],
  face_index: 3,
  type: "start" as const,
  seq_order: 0,
};
const input = {
  scan: {
    id: "s1",
    openbeta_area_id: null,
    openbeta_climb_id: null,
    content_hash: hash,
    tri_count: 1,
    texture_res: null,
    capture_app: "x",
    captured_at: null,
    license: "CC-BY-SA-4.0" as const,
  },
  climbs: [climb],
  holds: [hold],
  paths: [
    {
      id: "p1",
      climb_id: "c1",
      kind: "line" as const,
      points: [[0, 0, 0] as [number, number, number]],
    },
  ],
  contributors: [
    { handle: "zed", role: "scan" as const },
    { handle: "zed", role: "climb" as const },
  ],
  glb,
  exportedAt: "2026-11-11T00:00:00Z",
};

describe("boulder export", () => {
  it("round-trips: export then import yields identical data", () => {
    const parsed = parseBoulderExport(buildBoulderExport(input));
    expect(parsed.glb).toEqual(glb);
    expect(parsed.climbs).toEqual(input.climbs);
    expect(parsed.holds).toEqual(input.holds);
    expect(parsed.paths).toEqual(input.paths);
    expect(parsed.manifest.schema_version).toBe(1);
  });

  it("includes license and a de-duplicated attribution list", () => {
    const names = readZip(buildBoulderExport(input));
    const attr = new TextDecoder().decode(
      names.find((e) => e.name === "ATTRIBUTION.txt")!.data,
    );
    expect(attr.match(/- zed/g)).toHaveLength(1);
    expect(names.map((e) => e.name)).toContain("LICENSE.txt");
  });

  it("contains no geographic fields", () => {
    const text = readZip(buildBoulderExport(input))
      .filter((e) => e.name.endsWith(".json"))
      .map((e) => new TextDecoder().decode(e.data))
      .join("");
    expect(text).not.toMatch(/"(lat|lng|lon|bbox|coordinates)"/);
  });

  it("refuses a GLB that doesn't match content_hash", () => {
    expect(() =>
      buildBoulderExport({ ...input, glb: new Uint8Array([9]) }),
    ).toThrow(/hash/);
  });

  it("rejects holds anchored to a different mesh on import", () => {
    const bad = buildBoulderExport({
      ...input,
      holds: [{ ...hold, scan_content_hash: "0".repeat(64) }],
    });
    expect(() => parseBoulderExport(bad)).toThrow(/different mesh/);
  });
});
