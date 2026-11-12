// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { meshSurfaceFromParsed } from "../annotations/surface";
import type { UploadKind } from "../upload/validate";
import { buildCanonicalGlb } from "./canonical";
import { flattenDocument, readGltfDocument } from "./gltf";
import { runQcChecks } from "./run";
import { stripImageMetadata } from "./strip";
import { renderThumbnailWebp } from "./thumbnail";

const DIR = fileURLToPath(new URL("../../../fixtures/qc/", import.meta.url));

async function canonical(name: string) {
  const bytes = new Uint8Array(readFileSync(DIR + name));
  const r = await runQcChecks({
    bytes,
    kind: name.split(".").pop() as UploadKind,
  });
  if (!r.mesh) throw new Error("fixture did not parse");
  return { r, glb: await buildCanonicalGlb(r.mesh, r.document) };
}

describe("canonical GLB", () => {
  it.each([
    "good-polycam-like.glb",
    "good-scaniverse-like.ply",
    "good-obj.zip",
    "good-draco.glb",
    "good-georeferenced.zip",
  ])("%s: hash is sha256 of the bytes and is deterministic", async (name) => {
    const a = await canonical(name);
    const b = await canonical(name);
    expect(a.glb.contentHash).toBe(
      createHash("sha256").update(a.glb.bytes).digest("hex"),
    );
    expect(b.glb.contentHash).toBe(a.glb.contentHash);
    expect(Buffer.from(b.glb.bytes).equals(Buffer.from(a.glb.bytes))).toBe(
      true,
    );
  });

  it("is one meshopt-compressed mesh, no extras or names, no Draco", async () => {
    const { glb } = await canonical("good-polycam-like.glb");
    const doc = await readGltfDocument({ kind: "glb", bytes: glb.bytes });
    const root = doc.getRoot();
    expect(root.listMeshes()).toHaveLength(1);
    expect(root.listMeshes()[0]!.listPrimitives()).toHaveLength(1);
    const names = [
      ...root.listNodes(),
      ...root.listMeshes(),
      ...root.listMaterials(),
      ...root.listTextures(),
    ];
    expect(names.every((x) => x.getName() === "")).toBe(true);
    const json = JSON.stringify(
      JSON.parse(
        new TextDecoder().decode(
          glb.bytes.subarray(
            20,
            20 +
              new DataView(glb.bytes.buffer, glb.bytes.byteOffset).getUint32(
                12,
                true,
              ),
          ),
        ),
      ),
    );
    expect(json).toContain("EXT_meshopt_compression");
    expect(json).not.toContain("KHR_draco");
    expect(json).not.toContain('"extras"');
  });

  it("the validator's surface agrees with the GLB's own frame", async () => {
    const { r, glb } = await canonical("good-polycam-like.glb");
    const doc = await readGltfDocument({ kind: "glb", bytes: glb.bytes });
    const decoded = flattenDocument(doc, "glb");
    const surface = meshSurfaceFromParsed(decoded);

    // Welding and reordering keep the triangle count (no degenerate faces here).
    expect(decoded.indices.length / 3).toBe(r.triCount);
    expect(surface.indices.length / 3).toBe(r.triCount);
    // Grounded: lowest point at y = 0; centred on x and z.
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < surface.positions.length; i++) {
      const k = i % 3;
      lo[k] = Math.min(lo[k]!, surface.positions[i]!);
      hi[k] = Math.max(hi[k]!, surface.positions[i]!);
    }
    expect(lo[1]).toBeCloseTo(0, 3); // quantized: within a fraction of a mm
    expect((lo[0]! + hi[0]!) / 2).toBeCloseTo(0, 2);
    expect((lo[2]! + hi[2]!) / 2).toBeCloseTo(0, 2);
    // Extents unchanged by quantization to within 1 mm.
    const e = r.report.extents_m!;
    expect(hi[0]! - lo[0]!).toBeCloseTo(e.width, 2);
    expect(hi[1]! - lo[1]!).toBeCloseTo(e.height, 2);
    expect(hi[2]! - lo[2]!).toBeCloseTo(e.depth, 2);
  });

  it("recentres a georeferenced scan: no absolute coordinates in the GLB", async () => {
    const { glb } = await canonical("good-georeferenced.zip");
    expect(glb.recentred).toBe(true);
    const doc = await readGltfDocument({ kind: "glb", bytes: glb.bytes });
    const surface = meshSurfaceFromParsed(flattenDocument(doc, "glb"));
    expect(Math.max(...Array.from(surface.positions, Math.abs))).toBeLessThan(
      1000,
    );
  });

  it("keeps the texture, with EXIF removed", async () => {
    const { glb } = await canonical("good-polycam-like.glb");
    const doc = await readGltfDocument({ kind: "glb", bytes: glb.bytes });
    const tex = doc.getRoot().listTextures();
    expect(tex).toHaveLength(1);
    expect(Buffer.from(tex[0]!.getImage()!).includes("Exif")).toBe(false);
  });
});

describe("stripImageMetadata", () => {
  const seg = (marker: number, body: number[]) => [
    0xff,
    marker,
    0,
    body.length + 2,
    ...body,
  ];
  const jpeg = new Uint8Array([
    0xff,
    0xd8,
    ...seg(0xe0, [0x4a, 0x46]),
    ...seg(0xe1, [...Buffer.from("Exif\0\0GPS")]),
    ...seg(0xfe, [0x68, 0x69]),
    0xff,
    0xda,
    0,
    2,
    1,
    2,
    3,
    0xff,
    0xd9,
  ]);

  it("drops EXIF and comments from a JPEG, keeps the pixel stream", () => {
    const out = stripImageMetadata(jpeg, "image/jpeg");
    expect(Buffer.from(out).includes("Exif")).toBe(false);
    expect([...out.subarray(out.length - 9)]).toEqual([
      0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9,
    ]);
    expect(out.length).toBeLessThan(jpeg.length);
  });

  it("drops eXIf and text chunks from a PNG", () => {
    const chunk = (type: string, data: number[]) => [
      0,
      0,
      0,
      data.length,
      ...Buffer.from(type),
      ...data,
      0,
      0,
      0,
      0,
    ];
    const png = new Uint8Array([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      ...chunk("IHDR", new Array(13).fill(0)),
      ...chunk("eXIf", [1, 2, 3]),
      ...chunk("tEXt", [65, 0, 66]),
      ...chunk("IEND", []),
    ]);
    const out = Buffer.from(stripImageMetadata(png, "image/png"));
    expect(out.includes("eXIf")).toBe(false);
    expect(out.includes("tEXt")).toBe(false);
    expect(out.includes("IHDR")).toBe(true);
  });
});

describe("thumbnail", () => {
  it("renders a 512 px WebP", async () => {
    const { glb } = await canonical("good-polycam-like.glb");
    const webp = await renderThumbnailWebp(glb.positions, glb.indices);
    expect(Buffer.from(webp.subarray(0, 4)).toString()).toBe("RIFF");
    expect(Buffer.from(webp.subarray(8, 12)).toString()).toBe("WEBP");
    expect(webp.length).toBeGreaterThan(500);
  });
});
