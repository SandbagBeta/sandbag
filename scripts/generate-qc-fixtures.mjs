#!/usr/bin/env node
// Golden QC fixtures (#16, ADR 003 §7). Deterministic: integer-hash noise,
// pure-JS JPEG encoding (jpeg-js), fixed zip timestamps, so the same script
// writes byte-identical files on every run. `src/lib/qc/golden.test.ts`
// regenerates them in memory and fails if the committed files differ.
//
// Usage: node scripts/generate-qc-fixtures.mjs   (writes fixtures/qc/)
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import { zipSync } from "fflate";
import jpeg from "jpeg-js";
import { generateBoulder } from "./lib/boulder-geometry.mjs";

const OUT_DIR = new URL("../fixtures/qc/", import.meta.url);
// ZIP stores local calendar fields, not a UTC instant. Keep those fields fixed
// so fflate writes the same DOS timestamp in every host time zone.
const ZIP_MTIME = new Date(2026, 0, 1);
const RES = 41; // 12·41² = 20,172 triangles, just above the 10k minimum

// ---------------------------------------------------------------------------
// Deterministic helpers

function lcg(seed) {
  let h = seed >>> 0;
  return () => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return h / 4294967296;
  };
}

/** Smooth grey "rock" texture: bilinear blend of a coarse random grid. */
function makeJpeg(size, seed = 1, quality = 70) {
  const rand = lcg(seed);
  const cells = 16;
  const grid = Array.from({ length: (cells + 1) ** 2 }, () => rand());
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const gy = (y / size) * cells;
    const y0 = Math.floor(gy);
    const ty = gy - y0;
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const x0 = Math.floor(gx);
      const tx = gx - x0;
      const g = (i, j) => grid[(y0 + j) * (cells + 1) + x0 + i];
      const v =
        g(0, 0) * (1 - tx) * (1 - ty) +
        g(1, 0) * tx * (1 - ty) +
        g(0, 1) * (1 - tx) * ty +
        g(1, 1) * tx * ty;
      const o = (y * size + x) * 4;
      const base = 80 + Math.round(v * 90);
      data[o] = base + 12;
      data[o + 1] = base + 6;
      data[o + 2] = base;
      data[o + 3] = 255;
    }
  }
  return new Uint8Array(
    jpeg.encode({ data, width: size, height: size }, quality).data,
  );
}

/**
 * Inserts an EXIF APP1 segment with a GPS IFD after the JPEG's SOI marker,
 * like a phone photo. The position is synthetic (open sea at 0.5° N, 0.5° E).
 */
function withExifGps(jpg) {
  const tiff = Buffer.alloc(8 + 18 + 70 + 48);
  let o = 0;
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  o = 8;
  // IFD0: one entry, the GPS IFD pointer (tag 0x8825).
  tiff.writeUInt16LE(1, o);
  tiff.writeUInt16LE(0x8825, o + 2);
  tiff.writeUInt16LE(4, o + 4); // LONG
  tiff.writeUInt32LE(1, o + 6);
  tiff.writeUInt32LE(26, o + 10); // GPS IFD offset
  tiff.writeUInt32LE(0, o + 14); // no next IFD
  o = 26;
  const rationals = 26 + 2 + 5 * 12 + 4; // after the GPS IFD
  const entries = [
    [0x0000, 1, 4, Buffer.from([2, 3, 0, 0])], // GPSVersionID
    [0x0001, 2, 2, Buffer.from("N\0", "latin1")], // north ref
    [0x0002, 5, 3, rationals], // north: 0° 30' 0"
    [0x0003, 2, 2, Buffer.from("E\0", "latin1")], // east ref
    [0x0004, 5, 3, rationals + 24], // east: 0° 30' 0"
  ];
  tiff.writeUInt16LE(entries.length, o);
  o += 2;
  for (const [tag, type, count, value] of entries) {
    tiff.writeUInt16LE(tag, o);
    tiff.writeUInt16LE(type, o + 2);
    tiff.writeUInt32LE(count, o + 4);
    if (typeof value === "number") tiff.writeUInt32LE(value, o + 8);
    else value.copy(tiff, o + 8);
    o += 12;
  }
  tiff.writeUInt32LE(0, o);
  for (const at of [rationals, rationals + 24]) {
    [0, 1, 30, 1, 0, 1].forEach((v, i) => tiff.writeUInt32LE(v, at + i * 4));
  }
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  return new Uint8Array(
    Buffer.concat([jpg.subarray(0, 2), app1, payload, jpg.subarray(2)]),
  );
}

// ---------------------------------------------------------------------------
// Mesh building

/** The demo boulder as plain arrays (watertight, ~2.3 m across). */
function boulder(resolution = RES, extra = {}) {
  const g = generateBoulder({ resolution, ...extra });
  return {
    positions: Array.from(g.positions),
    colors: Array.from(g.colors, (c) => Math.round(c * 255)),
    indices: Array.from(g.indices),
  };
}

/** Appends `count` small disconnected blobs around the main mesh. */
function addFloaters(mesh, count, seed) {
  const rand = lcg(seed);
  for (let f = 0; f < count; f++) {
    const blob = generateBoulder({
      resolution: 3,
      radii: [0.06, 0.05, 0.06],
      displacement: 0.01,
      floorY: -1,
      seed: 100 + f,
    });
    const angle = rand() * 2 * Math.PI;
    const r = 1.4 + rand() * 0.5;
    const offset = [r * Math.cos(angle), rand() * 1.5, r * Math.sin(angle)];
    const base = mesh.positions.length / 3;
    blob.positions.forEach((v, i) => mesh.positions.push(v + offset[i % 3]));
    blob.colors.forEach((c) => mesh.colors.push(Math.round(c * 255)));
    blob.indices.forEach((i) => mesh.indices.push(base + i));
  }
  return mesh;
}

/**
 * Splits vertices into 6 charts by each face's dominant normal axis and gives
 * them planar UVs in a 3×2 atlas: duplicated positions along chart borders,
 * like the UV seams of a real photogrammetry export.
 */
function withUvSeams(mesh) {
  const { positions: P, indices } = mesh;
  const out = { positions: [], colors: [], uvs: [], indices: [] };
  const map = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const e1 = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const axis = [0, 1, 2].reduce((m, k) =>
      Math.abs(n[k]) > Math.abs(n[m]) ? k : m,
    );
    const chart = axis * 2 + (n[axis] < 0 ? 1 : 0);
    for (const v of [a, b, c]) {
      const key = v * 6 + chart;
      let i = map.get(key);
      if (i === undefined) {
        i = out.positions.length / 3;
        map.set(key, i);
        const [u, w] = [0, 1, 2].filter((k) => k !== axis);
        out.positions.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        out.colors.push(...mesh.colors.slice(v * 3, v * 3 + 3));
        const cu = (chart % 3) / 3;
        const cv = Math.floor(chart / 3) / 2;
        out.uvs.push(
          cu + (0.5 + P[v * 3 + u] / 3) / 3,
          cv + (0.5 + P[v * 3 + w] / 3) / 2,
        );
      }
      out.indices.push(i);
    }
  }
  return out;
}

/** Same planar UVs without splitting (for OBJ, which stores vt separately). */
function planarUvs(mesh) {
  const uvs = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    uvs.push(0.5 + mesh.positions[i] / 5, 0.5 + mesh.positions[i + 2] / 5);
  }
  return { ...mesh, uvs };
}

function scale(mesh, s) {
  return { ...mesh, positions: mesh.positions.map((v) => v * s) };
}

/** Flat 100×100-cell square, 2 m wide, all at y = 0 (20,000 triangles). */
function flatGrid(cells = 100, width = 2) {
  const positions = [];
  const colors = [];
  const indices = [];
  for (let j = 0; j <= cells; j++) {
    for (let i = 0; i <= cells; i++) {
      positions.push((i / cells - 0.5) * width, 0, (j / cells - 0.5) * width);
      colors.push(120, 110, 100);
    }
  }
  const row = cells + 1;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const v = j * row + i;
      indices.push(v, v + row, v + 1, v + 1, v + row, v + row + 1);
    }
  }
  return { positions, colors, indices };
}

// ---------------------------------------------------------------------------
// Writers

let dracoEncoder;
async function io() {
  dracoEncoder ??= await draco3d.createEncoderModule();
  return new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({ "draco3d.encoder": dracoEncoder });
}

async function glb(
  mesh,
  { texture = null, colors = false, dracoCompress = false } = {},
) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const n = mesh.positions.length / 3;
  const acc = (type, array) =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buf);
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", acc("VEC3", new Float32Array(mesh.positions)))
    .setIndices(
      acc(
        "SCALAR",
        n < 65536
          ? new Uint16Array(mesh.indices)
          : new Uint32Array(mesh.indices),
      ),
    );
  const material = doc.createMaterial("rock");
  if (colors) {
    prim.setAttribute(
      "COLOR_0",
      acc("VEC3", new Uint8Array(mesh.colors)).setNormalized(true),
    );
  }
  if (texture) {
    prim.setAttribute("TEXCOORD_0", acc("VEC2", new Float32Array(mesh.uvs)));
    material.setBaseColorTexture(
      doc.createTexture("albedo").setImage(texture).setMimeType("image/jpeg"),
    );
  }
  prim.setMaterial(material);
  doc
    .createScene()
    .addChild(
      doc.createNode("scan").setMesh(doc.createMesh("scan").addPrimitive(prim)),
    );
  if (dracoCompress) {
    doc
      .createExtension(KHRDracoMeshCompression)
      .setRequired(true)
      .setEncoderOptions({
        method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
        encodeSpeed: 5,
        decodeSpeed: 5,
      });
  }
  return new Uint8Array(await (await io()).writeBinary(doc));
}

/** PLY with xyz float + rgb uchar + int face lists. */
function ply(mesh, format, { faceCount } = {}) {
  const nv = mesh.positions.length / 3;
  const nf = mesh.indices.length / 3;
  const header =
    `ply\nformat ${format} 1.0\ncomment sandbag qc fixture\n` +
    `element vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\n` +
    `property uchar red\nproperty uchar green\nproperty uchar blue\n` +
    `element face ${faceCount ?? nf}\nproperty list uchar int vertex_indices\nend_header\n`;
  if (format === "ascii") {
    const lines = [header.trimEnd()];
    for (let i = 0; i < nv; i++) {
      const p = mesh.positions
        .slice(i * 3, i * 3 + 3)
        .map((v) => +v.toFixed(5));
      lines.push([...p, ...mesh.colors.slice(i * 3, i * 3 + 3)].join(" "));
    }
    for (let f = 0; f < nf; f++) {
      lines.push(`3 ${mesh.indices.slice(f * 3, f * 3 + 3).join(" ")}`);
    }
    return new Uint8Array(Buffer.from(lines.join("\n") + "\n", "latin1"));
  }
  const le = format === "binary_little_endian";
  const body = Buffer.alloc(nv * 15 + nf * 13);
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let o = 0;
  for (let i = 0; i < nv; i++, o += 15) {
    for (let k = 0; k < 3; k++)
      dv.setFloat32(o + k * 4, mesh.positions[i * 3 + k], le);
    for (let k = 0; k < 3; k++) dv.setUint8(o + 12 + k, mesh.colors[i * 3 + k]);
  }
  for (let f = 0; f < nf; f++, o += 13) {
    dv.setUint8(o, 3);
    for (let k = 0; k < 3; k++)
      dv.setInt32(o + 1 + k * 4, mesh.indices[f * 3 + k], le);
  }
  return new Uint8Array(Buffer.concat([Buffer.from(header, "latin1"), body]));
}

/** OBJ text with v, vt, faces as v/vt, one material. */
function obj(mesh, { offset = [0, 0, 0], digits = 5 } = {}) {
  const lines = ["# sandbag qc fixture", "mtllib scan.mtl", "o scan"];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p = [0, 1, 2].map((k) =>
      (mesh.positions[i + k] + offset[k]).toFixed(digits),
    );
    lines.push(`v ${p.join(" ")}`);
  }
  for (let i = 0; i < mesh.uvs.length; i += 2) {
    lines.push(`vt ${mesh.uvs[i].toFixed(5)} ${mesh.uvs[i + 1].toFixed(5)}`);
  }
  lines.push("usemtl rock");
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const c = mesh.indices.slice(t, t + 3).map((i) => `${i + 1}/${i + 1}`);
    lines.push(`f ${c.join(" ")}`);
  }
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

const MTL = new TextEncoder().encode(
  "newmtl rock\nKa 1 1 1\nKd 1 1 1\nmap_Kd textures/rock.jpg\n",
);

function zip(files) {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([k, v]) => [k, [v, { mtime: ZIP_MTIME }]]),
    ),
    { level: 6, mtime: ZIP_MTIME },
  );
}

// ---------------------------------------------------------------------------

/** Every fixture, name → bytes. */
export async function generateQcFixtures() {
  const tex2048 = makeJpeg(2048, 1);
  const tex1024 = makeJpeg(1024, 2);
  const tex512 = makeJpeg(512, 3);
  const main = boulder();
  const out = {};

  // Good (must pass).
  out["good-polycam-like.glb"] = await glb(withUvSeams(main), {
    texture: tex2048,
  });
  out["good-scaniverse-like.ply"] = ply(main, "binary_little_endian");
  // 77 blobs × 56 vertices ≈ 30% of all vertices outside the boulder.
  out["good-obj.zip"] = zip({
    "scan.obj": obj(planarUvs(addFloaters(boulder(), 77, 7))),
    "scan.mtl": MTL,
    "textures/rock.jpg": tex1024,
  });
  out["good-draco.glb"] = await glb(main, {
    colors: true,
    dracoCompress: true,
  });
  out["good-georeferenced.zip"] = zip({
    // UTM-sized offsets (easting, elevation, northing), as survey exports have.
    "scan.obj": obj(planarUvs(main), {
      offset: [500000, 1500, 4600000],
      digits: 4,
    }),
    "scan.mtl": MTL,
    "textures/rock.jpg": withExifGps(makeJpeg(2048, 4)),
  });

  // Bad (must fail with the named reason).
  out["bad-magic.glb"] = makeJpeg(64, 5);
  const plain = await glb(main, { colors: true });
  out["bad-truncated.glb"] = plain.slice(0, Math.floor(plain.length / 2));
  out["bad-too-few-tris.ply"] = ply(boulder(13), "binary_big_endian");
  out["bad-scale-mm.glb"] = await glb(scale(main, 1000), { colors: true });
  out["bad-flat.ply"] = ply(flatGrid(), "ascii");
  // 270 blobs × 56 vertices ≈ 60% of all vertices outside the boulder.
  out["bad-floaters.glb"] = await glb(addFloaters(boulder(), 270, 9), {
    colors: true,
  });
  out["bad-small-texture.glb"] = await glb(withUvSeams(main), {
    texture: tex512,
  });
  // Header claims 6M faces; the body holds one triangle and stops.
  out["bad-too-many-tris.ply"] = ply(
    {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      colors: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      indices: [0, 1, 2],
    },
    "binary_little_endian",
    { faceCount: 6_000_000 },
  );
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await mkdir(OUT_DIR, { recursive: true });
  const fixtures = await generateQcFixtures();
  let total = 0;
  for (const [name, bytes] of Object.entries(fixtures)) {
    await writeFile(new URL(name, OUT_DIR), bytes);
    total += bytes.length;
    console.log(name.padEnd(28), `${(bytes.length / 1024).toFixed(0)} KB`);
  }
  console.log("total".padEnd(28), `${(total / 1024 / 1024).toFixed(2)} MB`);
}
