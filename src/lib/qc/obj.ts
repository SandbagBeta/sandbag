import { imageSize } from "./image";
import {
  centreToFloat32,
  MeshParseError,
  type ParsedMesh,
  type TextureSize,
} from "./mesh";

/**
 * Small indexed OBJ + MTL reader (ADR 003 §3: obj2gltf pulls in ~140 MB of
 * Cesium). Reads v (with optional per-vertex colour), vt, f (any polygon,
 * fan-triangulated, negative indices), usemtl, mtllib and map_Kd. Normals
 * are ignored: QC doesn't need them and the canonical GLB recomputes them.
 */

/** Looks a file up relative to the OBJ; null when it isn't in the upload. */
export type ResolveFile = (ref: string) => Uint8Array | null;

class Growable {
  data: Float64Array | Int32Array;
  length = 0;
  constructor(kind: "f64" | "i32", capacity = 1024) {
    this.data =
      kind === "f64" ? new Float64Array(capacity) : new Int32Array(capacity);
  }
  push(v: number) {
    if (this.length === this.data.length) {
      const grown = new (this.data.constructor as Float64ArrayConstructor)(
        this.data.length * 2,
      );
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.length++] = v;
  }
}

/** Calls `fn` with each line of `text`, without splitting it all at once. */
function eachLine(text: string, fn: (line: string) => void) {
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    fn(text.slice(start, end));
    start = end + 1;
  }
}

/** Cheap lower bound on triangles (one per `f` line), for the H3 fast-fail. */
export function objFaceLineCount(text: string): number {
  let count = 0;
  let i = text.startsWith("f ") ? 0 : text.indexOf("\nf ");
  while (i >= 0) {
    count++;
    i = text.indexOf("\nf ", i + 1);
  }
  return count;
}

const corrupt = () =>
  new MeshParseError(
    "The OBJ file is damaged (a line couldn't be read). Re-export and upload again.",
    "corrupt",
  );

export function parseObj(text: string, resolve: ResolveFile): ParsedMesh {
  const v = new Growable("f64");
  const vc = new Growable("f64");
  const vt = new Growable("f64");
  const cornerV = new Growable("i32");
  const cornerT = new Growable("i32");
  let allColored = true;
  const mtllibs: string[] = [];
  const usedMaterials = new Set<string>();
  let material: string | null = null;
  const face: number[] = [];

  eachLine(text, (raw) => {
    const line = raw.trim();
    if (!line || line[0] === "#") return;
    const sp = line.search(/\s/);
    const op = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? "" : line.slice(sp + 1).trim();
    if (op === "v") {
      const t = rest.split(/\s+/).map(Number);
      if (t.length < 3 || t.slice(0, 3).some(Number.isNaN)) throw corrupt();
      v.push(t[0]!);
      v.push(t[1]!);
      v.push(t[2]!);
      if (t.length >= 6 && t.length <= 7) {
        const c = t.length === 6 ? t.slice(3, 6) : t.slice(4, 7);
        for (const x of c)
          vc.push(Math.round(Math.min(1, Math.max(0, x)) * 255));
      } else allColored = false;
    } else if (op === "vt") {
      const t = rest.split(/\s+/).map(Number);
      vt.push(t[0] || 0);
      vt.push(t[1] || 0);
    } else if (op === "f") {
      face.length = 0;
      const nv = v.length / 3;
      const nt = vt.length / 2;
      for (const tok of rest.split(/\s+/)) {
        const [a, b] = tok.split("/");
        let vi = parseInt(a ?? "", 10);
        let ti = b ? parseInt(b, 10) : 0;
        if (!vi) throw corrupt();
        vi = vi < 0 ? nv + vi : vi - 1;
        ti = !ti ? -1 : ti < 0 ? nt + ti : ti - 1;
        if (vi < 0 || vi >= nv || ti >= nt) throw corrupt();
        face.push(vi, ti);
      }
      for (let k = 2; k < face.length / 2; k++) {
        for (const c of [0, k - 1, k]) {
          cornerV.push(face[c * 2]!);
          cornerT.push(face[c * 2 + 1]!);
        }
      }
      if (material !== null && face.length >= 6) usedMaterials.add(material);
    } else if (op === "usemtl") {
      material = rest;
    } else if (op === "mtllib") {
      mtllibs.push(rest);
    }
  });

  const corners = cornerV.length;
  if (corners === 0) {
    throw new MeshParseError(
      "The OBJ has no faces (it's a point cloud or empty). Export a mesh, not a point cloud.",
      "no_triangles",
    );
  }

  // One output vertex per distinct (position, uv) pair.
  const nt = vt.length / 2;
  const hasUv = nt > 0;
  const map = new Map<number, number>();
  const indices = new Uint32Array(corners);
  const srcV: number[] = [];
  const srcT: number[] = [];
  for (let i = 0; i < corners; i++) {
    const key = cornerV.data[i]! * (nt + 1) + (cornerT.data[i]! + 1);
    let out = map.get(key);
    if (out === undefined) {
      out = srcV.length;
      map.set(key, out);
      srcV.push(cornerV.data[i]!);
      srcT.push(cornerT.data[i]!);
    }
    indices[i] = out;
  }
  const n = srcV.length;
  const pos64 = new Float64Array(n * 3);
  const colored = allColored && vc.length === v.length;
  const colors = colored ? new Uint8Array(n * 3) : null;
  const uvs = hasUv ? new Float32Array(n * 2) : null;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      pos64[i * 3 + k] = v.data[srcV[i]! * 3 + k]!;
      if (colors) colors[i * 3 + k] = vc.data[srcV[i]! * 3 + k]!;
    }
    if (uvs && srcT[i]! >= 0) {
      uvs[i * 2] = vt.data[srcT[i]! * 2]!;
      uvs[i * 2 + 1] = vt.data[srcT[i]! * 2 + 1]!;
    }
  }

  const { textures, missingTextures } = readMaterials(
    mtllibs,
    usedMaterials,
    resolve,
  );
  const { positions, centre } = centreToFloat32(pos64);
  return {
    format: "obj",
    positions,
    indices,
    colors,
    colorSize: 3,
    uvs,
    textures,
    missingTextures,
    centre,
  };
}

/** Base-colour (map_Kd) textures of the materials the faces use. */
function readMaterials(
  mtllibs: string[],
  used: Set<string>,
  resolve: ResolveFile,
): { textures: TextureSize[]; missingTextures: number } {
  const mapKd = new Map<string, string>();
  let missing = 0;
  for (const lib of mtllibs) {
    const bytes = resolve(lib) ?? resolveSplit(lib, resolve);
    if (!bytes) {
      missing++;
      continue;
    }
    let current: string | null = null;
    eachLine(new TextDecoder().decode(bytes), (raw) => {
      const line = raw.trim();
      const sp = line.search(/\s/);
      if (sp < 0) return;
      const op = line.slice(0, sp);
      const rest = line.slice(sp + 1).trim();
      if (op === "newmtl") current = rest;
      else if (op.toLowerCase() === "map_kd" && current !== null) {
        mapKd.set(current, stripMapOptions(rest));
      }
    });
  }
  const textures: TextureSize[] = [];
  for (const ref of new Set([...used].map((m) => mapKd.get(m)))) {
    if (ref === undefined) continue;
    const bytes = resolve(ref);
    const size = bytes ? imageSize(bytes) : null;
    if (size) textures.push(size);
    else missing++;
  }
  return { textures, missingTextures: missing };
}

/** `mtllib a.mtl b.mtl` lists several files when the whole line isn't one. */
function resolveSplit(lib: string, resolve: ResolveFile): Uint8Array | null {
  for (const part of lib.split(/\s+/)) {
    const bytes = resolve(part);
    if (bytes) return bytes;
  }
  return null;
}

/** `map_Kd -s 1 1 1 -bm 0.5 tex.jpg` → `tex.jpg` (options take 1–3 numbers). */
function stripMapOptions(rest: string): string {
  const t = rest.split(/\s+/);
  let i = 0;
  while (i < t.length - 1 && t[i]!.startsWith("-")) {
    i++;
    while (i < t.length - 1 && /^-?[\d.]+$|^(on|off)$/.test(t[i]!)) i++;
  }
  return t.slice(i).join(" ");
}
