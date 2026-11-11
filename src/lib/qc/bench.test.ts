// @vitest-environment node
import { Document, NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { generateBoulder } from "../../../scripts/lib/boulder-geometry.mjs";
import { formatMetrics } from "./metrics";
import { runQcChecks } from "./run";

/**
 * Opt-in timing/memory run on large synthetic scans (ADR 003 §7: large
 * inputs aren't committed). Not part of CI:
 *   QC_BENCH=100000,1000000 pnpm vitest run src/lib/qc/bench.test.ts
 * Peak RSS is the worker's lifetime peak, so sizes run smallest first.
 */
const sizes = (process.env.QC_BENCH ?? "")
  .split(",")
  .filter(Boolean)
  .map(Number);

function plyBytes(g: {
  positions: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
  colors: Float32Array<ArrayBuffer>;
}) {
  const nv = g.positions.length / 3;
  const nf = g.indices.length / 3;
  const header = new TextEncoder().encode(
    `ply\nformat binary_little_endian 1.0\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\n` +
      `property uchar red\nproperty uchar green\nproperty uchar blue\nelement face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`,
  );
  const out = new Uint8Array(header.length + nv * 15 + nf * 13);
  out.set(header);
  const dv = new DataView(out.buffer, header.length);
  let o = 0;
  for (let i = 0; i < nv; i++, o += 15) {
    for (let k = 0; k < 3; k++)
      dv.setFloat32(o + k * 4, g.positions[i * 3 + k]!, true);
    for (let k = 0; k < 3; k++)
      dv.setUint8(o + 12 + k, Math.round(g.colors[i * 3 + k]! * 255));
  }
  for (let f = 0; f < nf; f++, o += 13) {
    dv.setUint8(o, 3);
    for (let k = 0; k < 3; k++)
      dv.setInt32(o + 1 + k * 4, g.indices[f * 3 + k]!, true);
  }
  return out;
}

async function glbBytes(g: {
  positions: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
  colors: Float32Array<ArrayBuffer>;
}) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const acc = (
    type: "VEC3" | "SCALAR",
    a: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
  ) => doc.createAccessor().setType(type).setArray(a).setBuffer(buf);
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", acc("VEC3", g.positions))
    .setAttribute("COLOR_0", acc("VEC3", g.colors))
    .setIndices(acc("SCALAR", g.indices));
  doc
    .createScene()
    .addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
  return new NodeIO().writeBinary(doc);
}

describe.runIf(sizes.length > 0)("QC bench (opt-in)", () => {
  it.each(sizes)(
    "%i triangles",
    async (tris) => {
      const g = generateBoulder({
        resolution: Math.round(Math.sqrt(tris / 12)),
      }) as Parameters<typeof plyBytes>[0];
      for (const [kind, bytes] of [
        ["ply", plyBytes(g)],
        ["glb", await glbBytes(g)],
      ] as const) {
        const r = await runQcChecks({ bytes, kind });
        console.info(
          `${tris} tris ${kind} (${(bytes.length / 1e6).toFixed(1)} MB): ${formatMetrics(r.metrics)}`,
        );
        expect(r.passed).toBe(true);
      }
    },
    600_000,
  );
});
