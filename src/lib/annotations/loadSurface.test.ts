import { createHash } from "node:crypto";
import { Document, NodeIO } from "@gltf-transform/core";
import { describe, expect, it, vi } from "vitest";
import { createSurfaceLoader, MeshUnavailableError } from "./loadSurface";

vi.mock("server-only", () => ({}));

/** A one-triangle GLB; `size` makes each mesh (and so each hash) distinct. */
async function glb(size: number) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const prim = doc
    .createPrimitive()
    .setAttribute(
      "POSITION",
      doc
        .createAccessor()
        .setType("VEC3")
        .setArray(new Float32Array([0, 0, 0, size, 0, 0, 0, size, 0]))
        .setBuffer(buffer),
    )
    .setIndices(
      doc
        .createAccessor()
        .setType("SCALAR")
        .setArray(new Uint16Array([0, 1, 2]))
        .setBuffer(buffer),
    );
  doc
    .createScene()
    .addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
  const bytes = await new NodeIO().writeBinary(doc);
  const content_hash = createHash("sha256").update(bytes).digest("hex");
  return { bytes, ref: { content_hash, glb_path: `p/${size}.glb` } };
}

describe("createSurfaceLoader (#22 C)", () => {
  it("decodes once per content hash and serves repeats from memory", async () => {
    const a = await glb(1);
    const download = vi.fn(async () => a.bytes);
    const load = createSurfaceLoader();
    const first = await load(a.ref, download);
    const second = await load(a.ref, download);
    expect(download).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first.indices.length).toBe(3);
  });

  it("de-duplicates concurrent loads of the same mesh", async () => {
    const a = await glb(1);
    const download = vi.fn(async () => a.bytes);
    const load = createSurfaceLoader();
    const [x, y] = await Promise.all([
      load(a.ref, download),
      load(a.ref, download),
    ]);
    expect(download).toHaveBeenCalledTimes(1);
    expect(x).toBe(y);
  });

  it("evicts the least recently used mesh beyond maxEntries", async () => {
    const [a, b, c] = [await glb(1), await glb(2), await glb(3)];
    const files = new Map([a, b, c].map((m) => [m.ref.glb_path, m.bytes]));
    const download = vi.fn(async (p: string) => files.get(p)!);
    const load = createSurfaceLoader({ maxEntries: 2 });
    await load(a.ref, download);
    await load(b.ref, download);
    await load(a.ref, download); // a is now most recent; b is oldest
    await load(c.ref, download); // evicts b
    expect(download).toHaveBeenCalledTimes(3);
    await load(a.ref, download);
    expect(download).toHaveBeenCalledTimes(3); // a survived
    await load(b.ref, download);
    expect(download).toHaveBeenCalledTimes(4); // b was evicted
  });

  it("refuses bytes that don't match the content hash, and doesn't cache the failure", async () => {
    const a = await glb(1);
    const b = await glb(2);
    const load = createSurfaceLoader();
    const wrong = vi.fn(async () => b.bytes);
    await expect(load(a.ref, wrong)).rejects.toBeInstanceOf(
      MeshUnavailableError,
    );
    const right = vi.fn(async () => a.bytes);
    await expect(load(a.ref, right)).resolves.toBeDefined();
    expect(right).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed download", async () => {
    const a = await glb(1);
    const load = createSurfaceLoader();
    const down = vi.fn(async () => {
      throw new MeshUnavailableError("down");
    });
    await expect(load(a.ref, down)).rejects.toThrow("down");
    const up = vi.fn(async () => a.bytes);
    await expect(load(a.ref, up)).resolves.toBeDefined();
  });
});
