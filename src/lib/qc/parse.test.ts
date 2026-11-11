// @vitest-environment node
import { Document, NodeIO } from "@gltf-transform/core";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { generateBoulder } from "../../../scripts/lib/boulder-geometry.mjs";
import { sniff } from "./detect";
import { measureMesh } from "./geometry";
import { gltfJsonTriangleCount, readGlbJson } from "./gltf";
import { MeshParseError } from "./mesh";
import { objFaceLineCount, parseObj } from "./obj";
import { parsePly } from "./ply";
import { runQcChecks } from "./run";
import { openZip } from "./zip";

const enc = (s: string) => new TextEncoder().encode(s);

const boulder = (resolution = 30) =>
  generateBoulder({ resolution }) as {
    positions: Float32Array<ArrayBuffer>;
    colors: Float32Array<ArrayBuffer>;
    indices: Uint32Array<ArrayBuffer>;
  };

/** ASCII PLY from plain arrays; faces may be any polygon. */
function asciiPly(
  positions: ArrayLike<number>,
  faces: number[][],
  extraHeader = "",
  extraBody = "",
) {
  const nv = positions.length / 3;
  const head =
    `ply\nformat ascii 1.0\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\n` +
    `property uchar red\nproperty uchar green\nproperty uchar blue\nproperty float s\nproperty float t\n` +
    `${extraHeader}element face ${faces.length}\nproperty list uchar int vertex_indices\nend_header\n`;
  const verts = Array.from({ length: nv }, (_, i) =>
    [
      positions[i * 3],
      positions[i * 3 + 1],
      positions[i * 3 + 2],
      10,
      20,
      30,
      0.5,
      0.25,
    ].join(" "),
  );
  return enc(
    head +
      extraBody +
      verts.join("\n") +
      "\n" +
      faces.map((f) => `${f.length} ${f.join(" ")}`).join("\n") +
      "\n",
  );
}

describe("PLY reader", () => {
  it("reads ASCII with polygons (fan-triangulated), colours and uv", () => {
    const m = parsePly(
      asciiPly(
        [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0.5, 2, 0],
        [
          [0, 1, 2, 3],
          [3, 2, 4],
        ],
      ),
    );
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 0, 2, 3, 3, 2, 4]);
    expect(Array.from(m.colors!.slice(0, 3))).toEqual([10, 20, 30]);
    expect(Array.from(m.uvs!.slice(0, 2))).toEqual([0.5, 0.25]);
    // Centred on the bbox: x 0..1, y 0..2.
    expect(m.centre).toEqual([0.5, 1, 0]);
    expect(m.positions[0]).toBeCloseTo(-0.5);
  });

  it("skips unknown elements between vertices and faces", () => {
    const bytes = enc(
      "ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty double x\nproperty double y\nproperty double z\n" +
        "element material 1\nproperty list uchar ushort ids\nelement face 1\nproperty uchar flags\nproperty list uint8 uint32 vertex_index\nend_header\n",
    );
    const body = new DataView(new ArrayBuffer(3 * 24 + 1 + 4 + 1 + 1 + 12));
    let o = 0;
    for (const v of [0, 0, 0, 1, 0, 0, 0, 1, 0]) {
      body.setFloat64(o, v, true);
      o += 8;
    }
    body.setUint8(o++, 2); // material list of 2 ushorts
    o += 4;
    body.setUint8(o++, 7); // face flags
    body.setUint8(o++, 3);
    for (const i of [0, 1, 2]) {
      body.setUint32(o, i, true);
      o += 4;
    }
    const all = new Uint8Array(bytes.length + body.byteLength);
    all.set(bytes);
    all.set(new Uint8Array(body.buffer), bytes.length);
    const m = parsePly(all);
    expect(Array.from(m.indices)).toEqual([0, 1, 2]);
    expect(m.colors).toBeNull();
  });

  it.each([
    [
      "no faces (point cloud)",
      "ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n",
      "no_triangles",
    ],
    ["no end_header", "ply\nformat ascii 1.0\nelement vertex 1\n", "corrupt"],
    [
      "out-of-range index",
      "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 9\n",
      "corrupt",
    ],
    [
      "body ends early",
      "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n",
      "truncated",
    ],
    [
      "text instead of numbers",
      "ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\nnan x y\n",
      "corrupt",
    ],
  ])("rejects %s", (_, text, reason) => {
    expect(() => parsePly(enc(text))).toThrow(MeshParseError);
    try {
      parsePly(enc(text));
    } catch (e) {
      expect((e as MeshParseError).reason).toBe(reason);
    }
  });
});

describe("OBJ reader", () => {
  const files: Record<string, Uint8Array> = {};
  const resolve = (ref: string) => files[ref] ?? null;

  it("reads quads, negative indices, v/vt/vn and vertex colours", () => {
    const m = parseObj(
      "v 0 0 0 1 0 0\nv 1 0 0 0 1 0\nv 1 1 0 0 0 1\nv 0 1 0 1 1 1\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nvn 0 0 1\n" +
        "f 1/1/1 2/2/1 3/3/1 4/4/1\nf -4/-4 -2/-2 -1/-1\n",
      resolve,
    );
    expect(m.indices.length).toBe(9);
    expect(m.colors).not.toBeNull();
    expect(Array.from(m.colors!.slice(0, 3))).toEqual([255, 0, 0]);
    expect(m.uvs).not.toBeNull();
    expect(objFaceLineCount("v 0 0 0\nf 1 1 1\nf 1 1 1\n")).toBe(2);
  });

  it("counts a missing .mtl or texture as missing, not as uncoloured", () => {
    const text =
      "mtllib a.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl rock\nf 1 2 3\n";
    expect(parseObj(text, resolve).missingTextures).toBe(1);
    files["a.mtl"] = enc("newmtl rock\nmap_Kd -s 1 1 1 tex.jpg\n");
    const m = parseObj(text, resolve);
    expect(m.missingTextures).toBe(1);
    expect(m.textures).toEqual([]);
  });

  it("rejects faces pointing past the vertex list", () => {
    expect(() => parseObj("v 0 0 0\nf 1 2 3\n", resolve)).toThrow(/damaged/);
    expect(() => parseObj("v 0 0 0\n", resolve)).toThrow(/no faces/);
  });
});

describe("zip handling", () => {
  it("resolves files relative to the mesh, then by base name", () => {
    const z = openZip(
      zipSync({
        "scan/a.obj": enc("v 0 0 0"),
        "scan/tex/a.png": enc("x"),
        "b.mtl": enc("m"),
      }),
    );
    expect(z.kind).toBe("obj");
    expect(z.resolve("tex/a.png")).not.toBeNull();
    expect(z.resolve(".\\TEX\\a.png")).not.toBeNull();
    expect(z.resolve("b.mtl")).not.toBeNull();
    expect(z.resolve("nope.png")).toBeNull();
  });

  it("refuses zip bombs from the central directory, before inflating", () => {
    const big = zipSync({ "a.obj": new Uint8Array(2_000_000) });
    expect(() => openZip(big, 1_000_000)).toThrow(/too large/);
  });

  it.each([
    [{ "a.txt": enc("x") }, /no \.obj or \.gltf/],
    [{ "a.obj": enc("v"), "b.obj": enc("v") }, /more than one mesh/],
  ])("rejects a zip without exactly one mesh", (files, message) => {
    expect(() => openZip(zipSync(files))).toThrow(message);
  });

  it("rejects bytes that aren't a readable zip", () => {
    expect(() => openZip(enc("PK\x03\x04garbage"))).toThrow(/damaged/);
  });
});

describe("header pass", () => {
  it("counts GLB triangles from the JSON chunk, per node using the mesh", () => {
    expect(
      gltfJsonTriangleCount({
        accessors: [{ count: 9 }, { count: 30 }],
        meshes: [
          {
            primitives: [
              { indices: 0 },
              { attributes: { POSITION: 1 } },
              { mode: 1, indices: 1 },
            ],
          },
        ],
        nodes: [{ mesh: 0 }, { mesh: 0 }, {}],
      }),
    ).toBe(2 * (3 + 10));
  });

  it("fails a GLB whose JSON claims 6M triangles before decoding any buffer", async () => {
    const json = enc(
      JSON.stringify({
        asset: { version: "2.0" },
        accessors: [{ count: 18_000_000, componentType: 5125, type: "SCALAR" }],
        meshes: [{ primitives: [{ indices: 0, attributes: {} }] }],
        nodes: [{ mesh: 0 }],
      }).padEnd(200, " "),
    );
    const glb = new Uint8Array(20 + json.length);
    const dv = new DataView(glb.buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, glb.length, true);
    dv.setUint32(12, json.length, true);
    dv.setUint32(16, 0x4e4f534a, true);
    glb.set(json, 20);
    const r = await runQcChecks({ bytes: glb, kind: "glb" });
    expect(r.report.checks.at(-1)).toMatchObject({
      id: "too_large",
      pass: false,
    });
    expect(r.report.checks.at(-1)!.message).toMatch(
      /^This scan is too large: 6M triangles/,
    );
  });

  it("detects a GLB truncated inside its JSON chunk", async () => {
    const doc = new Document();
    doc.createBuffer();
    const glb = await new NodeIO().writeBinary(doc);
    expect(() => readGlbJson(glb.slice(0, 22))).toThrow(/incomplete/);
  });

  it.each([
    [enc("glTF"), "glb"],
    [enc("ply\r\nformat"), "ply"],
    [enc('  \n{"asset":{}}'), "gltf"],
    [enc("﻿{}"), "gltf"],
    [enc("solid cube"), "stl"],
    [enc("# Blender\nv 1 2 3"), "obj"],
    [enc("Kaydara FBX Binary"), "fbx"],
    [enc("%PDF-1.7"), "pdf"],
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "png"],
    [new Uint8Array([0x50, 0x4b, 3, 4]), "zip"],
    [new Uint8Array([1, 2, 3]), "unknown"],
  ])("sniffs %s as %s", (bytes, kind) => {
    expect(sniff(bytes)).toBe(kind);
  });
});

describe("pipeline on in-memory meshes", () => {
  it("S3: a 0.4 m scan passes to review with a units warning", async () => {
    const g = boulder();
    const small = g.positions.map((v) => v * (0.4 / 2.4));
    const faces = Array.from({ length: g.indices.length / 3 }, (_, t) =>
      Array.from(g.indices.slice(t * 3, t * 3 + 3)),
    );
    const r = await runQcChecks({ bytes: asciiPly(small, faces), kind: "ply" });
    expect(r.passed).toBe(true);
    expect(r.report.checks.find((c) => c.id === "scale")).toMatchObject({
      pass: false,
      severity: "warning",
    });
  });

  it("S4: duplicated faces (non-manifold edges) warn but pass", async () => {
    const g = boulder();
    const faces = Array.from({ length: g.indices.length / 3 }, (_, t) =>
      Array.from(g.indices.slice(t * 3, t * 3 + 3)),
    );
    // Repeat 5% of faces: their edges are then shared by four faces.
    const dup = faces
      .filter((_, i) => i % 20 === 0)
      .map((f) => [f[0]!, f[2]!, f[1]!]);
    // Plus 2% zero-area slivers (a vertex repeated).
    const sliver = faces
      .filter((_, i) => i % 50 === 0)
      .map((f) => [f[0]!, f[0]!, f[1]!]);
    const r = await runQcChecks({
      bytes: asciiPly(g.positions, [...faces, ...dup, ...sliver]),
      kind: "ply",
    });
    expect(r.passed).toBe(true);
    const q = r.report.checks.find((c) => c.id === "mesh_quality")!;
    expect(q).toMatchObject({ pass: false, severity: "warning" });
    expect(q.message).toMatch(/faces are degenerate .* edges are non-manifold/);
  });

  it("H2: a file over the plan cap stops before the header pass", async () => {
    const r = await runQcChecks({
      bytes: enc("ply\n" + " ".repeat(100)),
      kind: "ply",
      maxBytes: 50,
    });
    expect(r.report.checks.map((c) => [c.id, c.pass])).toEqual([
      ["file_type", true],
      ["file_size", false],
    ]);
  });

  it("H9: an uncoloured mesh fails, and the texture check is skipped", async () => {
    const g = boulder();
    const lines = Array.from(
      { length: g.positions.length / 3 },
      (_, i) =>
        `v ${g.positions[i * 3]} ${g.positions[i * 3 + 1]} ${g.positions[i * 3 + 2]}`,
    );
    for (let t = 0; t < g.indices.length; t += 3)
      lines.push(
        `f ${g.indices[t]! + 1} ${g.indices[t + 1]! + 1} ${g.indices[t + 2]! + 1}`,
      );
    const r = await runQcChecks({
      bytes: zipSync({ "a.obj": enc(lines.join("\n")) }),
      kind: "zip",
    });
    expect(r.passed).toBe(false);
    expect(r.report.checks.filter((c) => !c.pass).map((c) => c.id)).toEqual([
      "color",
    ]);
    expect(r.report.checks.map((c) => c.id)).not.toContain("texture_res");
  });

  it("reads a .gltf with an external .bin from its zip", async () => {
    const g = boulder();
    const doc = new Document();
    const buf = doc.createBuffer().setURI("scan.bin");
    const prim = doc
      .createPrimitive()
      .setAttribute(
        "POSITION",
        doc
          .createAccessor()
          .setType("VEC3")
          .setArray(g.positions)
          .setBuffer(buf),
      )
      .setAttribute(
        "COLOR_0",
        doc.createAccessor().setType("VEC3").setArray(g.colors).setBuffer(buf),
      )
      .setIndices(
        doc
          .createAccessor()
          .setType("SCALAR")
          .setArray(g.indices)
          .setBuffer(buf),
      );
    doc
      .createScene()
      .addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
    const { json, resources } = await new NodeIO().writeJSON(doc);
    const zip = zipSync({
      "m/scan.gltf": enc(JSON.stringify(json)),
      "m/scan.bin": resources["scan.bin"]!,
    });
    const r = await runQcChecks({ bytes: zip, kind: "zip" });
    expect(r.passed).toBe(true);
    expect(r.document).not.toBeNull();
    // A lone .gltf can't bring its .bin.
    const lone = await runQcChecks({
      bytes: enc(JSON.stringify(json)),
      kind: "gltf",
    });
    expect(lone.report.checks.at(-1)).toMatchObject({
      id: "parse",
      pass: false,
    });
    expect(lone.report.checks.at(-1)!.message).toMatch(/aren't in the upload/);
  });

  it("welds split vertices so seams aren't floaters or boundaries", () => {
    // Two triangles sharing an edge, stored with separate vertices.
    const m = measureMesh({
      format: "ply",
      positions: new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 5, 4]),
      colors: null,
      colorSize: 3,
      uvs: null,
      textures: [],
      missingTextures: 0,
      centre: [0, 0, 0],
    });
    expect(m.floaterFraction).toBe(0);
    expect(m.edges).toBe(5);
    expect(m.boundaryEdges).toBe(4);
    expect(m.volumeRatio).toBe(0);
  });
});
