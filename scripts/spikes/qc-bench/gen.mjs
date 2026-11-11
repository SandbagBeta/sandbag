#!/usr/bin/env node
// #16 spike (ADR 003): writes synthetic scans of a given triangle count as a
// textured GLB and a vertex-colored binary PLY. Not part of the app.
// Usage: node scripts/spikes/qc-bench/gen.mjs <outDir> <tris>[,<tris>...]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { Document, NodeIO } from "@gltf-transform/core";
import { generateBoulder } from "../../lib/boulder-geometry.mjs";

/** 4096² RGB PNG with low-frequency pattern + dither (~realistic size). */
export function makePng(size = 4096) {
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size);
  let h = 12345;
  for (let y = 0; y < size; y++) {
    raw[y * row] = 1; // filter: Sub
    for (let x = 0; x < size; x++) {
      h = (Math.imul(h, 1103515245) + 12345) | 0;
      const d = (h >>> 30) & 1; // small residuals compress like real photos
      const o = y * row + 1 + x * 3;
      raw[o] = raw[o + 1] = raw[o + 2] = x === 0 ? 110 : d;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let crcTable;
function crc32(buf) {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function writeGlb(path, g, png) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const n = g.positions.length / 3;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    uv[i * 2] =
      0.5 +
      Math.atan2(g.positions[i * 3 + 2], g.positions[i * 3]) / (2 * Math.PI);
    uv[i * 2 + 1] = Math.min(1, g.positions[i * 3 + 1] / 2);
  }
  const acc = (type, array) =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buf);
  const tex = doc
    .createTexture("albedo")
    .setImage(png)
    .setMimeType("image/png");
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", acc("VEC3", g.positions))
    .setAttribute("NORMAL", acc("VEC3", g.normals))
    .setAttribute("TEXCOORD_0", acc("VEC2", uv))
    .setIndices(acc("SCALAR", g.indices))
    .setMaterial(doc.createMaterial("rock").setBaseColorTexture(tex));
  const mesh = doc.createMesh("scan").addPrimitive(prim);
  doc.createScene().addChild(doc.createNode("scan").setMesh(mesh));
  await writeFile(path, await new NodeIO().writeBinary(doc));
}

export async function writePly(path, g) {
  const nv = g.positions.length / 3,
    nf = g.indices.length / 3;
  const header = Buffer.from(
    `ply\nformat binary_little_endian 1.0\ncomment sandbag spike\n` +
      `element vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\n` +
      `property uchar red\nproperty uchar green\nproperty uchar blue\n` +
      `element face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`,
  );
  const body = Buffer.alloc(nv * 15 + nf * 13);
  let o = 0;
  for (let i = 0; i < nv; i++, o += 15) {
    for (let k = 0; k < 3; k++)
      body.writeFloatLE(g.positions[i * 3 + k], o + k * 4);
    for (let k = 0; k < 3; k++)
      body[o + 12 + k] = Math.round(g.colors[i * 3 + k] * 255);
  }
  for (let f = 0; f < nf; f++, o += 13) {
    body[o] = 3;
    for (let k = 0; k < 3; k++)
      body.writeInt32LE(g.indices[f * 3 + k], o + 1 + k * 4);
  }
  await writeFile(path, Buffer.concat([header, body]));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [outDir, list = "100000"] = process.argv.slice(2);
  await mkdir(outDir, { recursive: true });
  const png = makePng();
  for (const tris of list.split(",").map(Number)) {
    const resolution = Math.round(Math.sqrt(tris / 12)); // 12·res² triangles
    const g = generateBoulder({ resolution });
    const name = `boulder-${Math.round(tris / 1000)}k`;
    await writeGlb(join(outDir, `${name}.glb`), g, png);
    await writePly(join(outDir, `${name}.ply`), g);
    console.log(
      name,
      g.indices.length / 3,
      "tris",
      g.positions.length / 3,
      "verts",
    );
  }
}
