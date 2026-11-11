#!/usr/bin/env node
// #16 spike (ADR 003): times one QC run on one file and prints a JSON line.
// Usage: node bench.mjs <file.glb|file.ply> <validate|full> [meshopt|draco] [outDir]
// Draco needs `draco3dgltf`, which is NOT a repo dependency: run from a temp
// install (see ADR 003 "Reproducing").
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Document, NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRDracoMeshCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { dedup, meshopt, prune, weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import { geometryChecks, imageSize, parsePly } from "./checks.mjs";
import { renderThumbnail } from "./raster.mjs";

const [file, mode = "validate", codec = "meshopt", outDir] =
  process.argv.slice(2);
const steps = [];
async function step(name, fn) {
  const c0 = process.cpuUsage(),
    t0 = performance.now();
  const out = await fn();
  const c = process.cpuUsage(c0);
  steps.push({
    name,
    wallMs: Math.round(performance.now() - t0),
    cpuMs: Math.round((c.user + c.system) / 1000),
    rssMB: Math.round(process.memoryUsage().rss / 2 ** 20),
  });
  return out;
}

const bytes = await step("read", () => readFile(file));
const isGlb = bytes.readUInt32LE(0) === 0x46546c67; // magic "glTF"
const isPly = bytes.subarray(0, 4).toString("latin1") === "ply\n";
if (!isGlb && !isPly) throw new Error("magic bytes: neither GLB nor PLY");

// Header-only pass: what an Edge Function could learn from a Range request.
const header = await step("header", () => {
  if (isPly) {
    const h = bytes.subarray(0, 1024).toString("latin1");
    return { tris: Number(/element face (\d+)/.exec(h)[1]) };
  }
  const jsonLen = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString("utf8"));
  const tris = json.meshes
    .flatMap((m) => m.primitives)
    .reduce((s, p) => s + json.accessors[p.indices].count / 3, 0);
  return { tris, jsonBytes: jsonLen };
});

const io = new NodeIO().registerExtensions([
  EXTMeshoptCompression,
  KHRMeshQuantization,
  KHRDracoMeshCompression,
]);
if (codec === "draco") {
  const draco3d = (await import("draco3dgltf")).default;
  io.registerDependencies({
    "draco3d.encoder": await draco3d.createEncoderModule(),
  });
} else {
  await MeshoptEncoder.ready;
  io.registerDependencies({ "meshopt.encoder": MeshoptEncoder });
}

const doc = await step("parse", async () => {
  if (isGlb)
    return io.readBinary(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    );
  const { positions, indices } = parsePly(bytes);
  const d = new Document(),
    buf = d.createBuffer();
  const prim = d
    .createPrimitive()
    .setAttribute(
      "POSITION",
      d.createAccessor().setType("VEC3").setArray(positions).setBuffer(buf),
    )
    .setIndices(
      d.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buf),
    );
  d.createScene().addChild(
    d.createNode().setMesh(d.createMesh().addPrimitive(prim)),
  );
  return d;
});

const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const positions = prim.getAttribute("POSITION").getArray();
const indices = prim.getIndices().getArray();
const checks = await step("checks", () => {
  const g = geometryChecks(positions, indices);
  const img = doc.getRoot().listTextures()[0]?.getImage();
  return { ...g, texture: img ? imageSize(img) : null };
});

let result = {};
if (mode === "full") {
  await step("weld+dedup+prune", () => doc.transform(dedup(), weld(), prune()));
  if (codec === "draco") {
    await step("draco", () => {
      doc
        .createExtension(KHRDracoMeshCompression)
        .setRequired(true)
        .setEncoderOptions({ encodeSpeed: 5, decodeSpeed: 5 });
    });
  } else {
    await step("meshopt(reorder+quantize)", () =>
      doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" })),
    );
  }
  const glb = await step(
    "write" + (codec === "draco" ? "(draco encode)" : ""),
    () => io.writeBinary(doc),
  );
  const hash = await step("sha256", () =>
    createHash("sha256").update(glb).digest("hex"),
  );
  const thumb = await step("thumbnail(512, pure JS)", () =>
    renderThumbnail(positions, indices),
  );
  if (outDir) {
    await writeFile(join(outDir, basename(file) + `.${codec}.glb`), glb);
    await writeFile(join(outDir, basename(file) + ".thumb.png"), thumb);
  }
  result = {
    outBytes: glb.byteLength,
    contentHash: hash,
    thumbBytes: thumb.byteLength,
  };
}

const total = steps.reduce(
  (s, x) => ({ wallMs: s.wallMs + x.wallMs, cpuMs: s.cpuMs + x.cpuMs }),
  { wallMs: 0, cpuMs: 0 },
);
console.log(
  JSON.stringify({
    file: basename(file),
    inBytes: bytes.byteLength,
    mode,
    codec,
    header,
    checks,
    ...result,
    steps,
    total,
    peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
  }),
);
