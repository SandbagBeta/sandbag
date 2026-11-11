import {
  NodeIO,
  type Accessor,
  type Document,
  type JSONDocument,
  type Texture,
} from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import { MeshoptDecoder } from "meshoptimizer";
import { imageSize } from "./image";
import {
  assertIndicesInRange,
  centreToFloat32,
  MeshParseError,
  type ParsedMesh,
  type TextureSize,
} from "./mesh";

/**
 * GLB / glTF 2.0 reading with @gltf-transform/core. Draco- and
 * meshopt-compressed inputs are decoded (draco3dgltf and meshoptimizer are
 * wasm, no native build). The I/O never touches the file system: GLBs are
 * read from bytes, and a .gltf's external files come only from its zip.
 */

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const MODE_TRIANGLES = 4;

const truncated = () =>
  new MeshParseError(
    "The file is incomplete or damaged (the mesh data ends early). Re-export and upload again.",
    "truncated",
  );
const unreadable = () =>
  new MeshParseError(
    "The file couldn't be read as glTF 2.0 (it's damaged, or uses a feature we don't support). Re-export as GLB and upload again.",
    "corrupt",
  );

type Json = Record<string, unknown> & {
  asset?: { version?: string };
  buffers?: { byteLength?: number; uri?: string }[];
  bufferViews?: { buffer?: number; byteOffset?: number; byteLength?: number }[];
  accessors?: { count?: number }[];
  meshes?: {
    primitives?: {
      mode?: number;
      indices?: number;
      attributes?: { POSITION?: number };
    }[];
  }[];
  nodes?: { mesh?: number }[];
  images?: { uri?: string }[];
};

/**
 * Reads and structurally checks a GLB's container: header length, chunk
 * bounds and buffer views. Cheap (no mesh data is decoded), so it runs in
 * the header pass and catches truncated uploads with a precise message.
 */
export function readGlbJson(bytes: Uint8Array): Json {
  if (bytes.length < 20) throw truncated();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw unreadable();
  if (dv.getUint32(4, true) !== 2) {
    throw new MeshParseError(
      "This is a glTF 1.0 file; we need glTF 2.0. Export as GLB (glTF 2.0) and upload again.",
      "unsupported",
    );
  }
  const length = dv.getUint32(8, true);
  if (length > bytes.length) throw truncated();
  const jsonLength = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== CHUNK_JSON) throw unreadable();
  if (20 + jsonLength > length) throw truncated();
  const json = parseJson(bytes.subarray(20, 20 + jsonLength));

  let binLength = 0;
  const binStart = 20 + jsonLength;
  if (binStart + 8 <= length) {
    binLength = dv.getUint32(binStart, true);
    if (dv.getUint32(binStart + 4, true) !== CHUNK_BIN) throw unreadable();
    if (binStart + 8 + binLength > length) throw truncated();
  }
  const sizes = (json.buffers ?? []).map((b, i) =>
    i === 0 && b.uri === undefined ? binLength : (b.byteLength ?? 0),
  );
  if (json.buffers?.[0] && json.buffers[0].uri === undefined) {
    if ((json.buffers[0].byteLength ?? 0) > binLength) throw truncated();
  }
  for (const view of json.bufferViews ?? []) {
    const end = (view.byteOffset ?? 0) + (view.byteLength ?? 0);
    if (end > (sizes[view.buffer ?? 0] ?? 0)) throw truncated();
  }
  return json;
}

function parseJson(bytes: Uint8Array): Json {
  try {
    const json = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      throw new Error();
    }
    return json as Json;
  } catch {
    throw unreadable();
  }
}

/** A .gltf file's JSON (for the header pass and for parsing). */
export function readGltfJson(bytes: Uint8Array): Json {
  return parseJson(bytes);
}

/**
 * Triangle count declared in the JSON, for the H3 fast-fail before any
 * buffer is decoded. Counts TRIANGLES primitives once per node using them.
 */
export function gltfJsonTriangleCount(json: Json): number {
  const accessors = json.accessors ?? [];
  const uses = new Map<number, number>();
  for (const node of json.nodes ?? []) {
    if (typeof node.mesh === "number") {
      uses.set(node.mesh, (uses.get(node.mesh) ?? 0) + 1);
    }
  }
  let total = 0;
  (json.meshes ?? []).forEach((mesh, m) => {
    let perMesh = 0;
    for (const prim of mesh.primitives ?? []) {
      if ((prim.mode ?? MODE_TRIANGLES) !== MODE_TRIANGLES) continue;
      const acc = prim.indices ?? prim.attributes?.POSITION;
      perMesh += Math.floor((accessors[acc ?? -1]?.count ?? 0) / 3);
    }
    total += perMesh * (uses.get(m) ?? 0);
  });
  return total;
}

let ioPromise: Promise<NodeIO> | null = null;

function getIO(): Promise<NodeIO> {
  ioPromise ??= (async () => {
    await MeshoptDecoder.ready;
    return new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        "draco3d.decoder": await draco3d.createDecoderModule(),
        "meshopt.decoder": MeshoptDecoder,
      });
  })();
  return ioPromise;
}

const isDataUri = (uri: string) => uri.startsWith("data:");

/** Reads a GLB, or a .gltf whose external files `resolve` supplies. */
export async function readGltfDocument(
  input:
    | { kind: "glb"; bytes: Uint8Array }
    | {
        kind: "gltf";
        json: Json;
        resolve: (uri: string) => Uint8Array | null;
      },
): Promise<Document> {
  const io = await getIO();
  if (input.kind === "glb") {
    readGlbJson(input.bytes);
    try {
      return await io.readBinary(input.bytes);
    } catch {
      throw unreadable();
    }
  }
  const { json, resolve } = input;
  if (!json.asset?.version?.startsWith("2.")) throw unreadable();
  const resources: Record<string, Uint8Array> = {};
  const uris = [
    ...(json.buffers ?? []).map((b) => b.uri),
    ...(json.images ?? []).map((i) => i.uri),
  ];
  for (const uri of uris) {
    if (uri === undefined || isDataUri(uri) || uri in resources) continue;
    const file = resolve(uri);
    if (!file) {
      throw new MeshParseError(
        "The .gltf refers to files (.bin or textures) that aren't in the upload. Zip the .gltf with all its files, or export a single .glb.",
        "corrupt",
      );
    }
    resources[uri] = file;
  }
  try {
    return await io.readJSON({ json, resources } as JSONDocument);
  } catch {
    throw unreadable();
  }
}

/** Per-element reader; denormalises quantized or normalized accessors. */
function reader(acc: Accessor, size: number) {
  const arr = acc.getArray();
  const es = acc.getElementSize();
  if (arr instanceof Float32Array && !acc.getNormalized()) {
    return (i: number, out: Float64Array) => {
      for (let k = 0; k < size; k++) out[k] = k < es ? arr[i * es + k]! : 1;
    };
  }
  const el: number[] = new Array(es).fill(0);
  return (i: number, out: Float64Array) => {
    acc.getElement(i, el);
    for (let k = 0; k < size; k++) out[k] = k < es ? el[k]! : 1;
  };
}

/** Flattens the default scene's triangle primitives into world space. */
export function flattenDocument(
  doc: Document,
  format: "glb" | "gltf",
): ParsedMesh {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const parts: {
    pos: Float64Array;
    idx: Uint32Array;
    col: Uint8Array | null;
    uv: Float32Array | null;
  }[] = [];
  const textures = new Set<Texture>();
  let missingTextures = 0;

  scene?.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== MODE_TRIANGLES) continue;
      const position = prim.getAttribute("POSITION");
      if (!position || position.getCount() === 0) continue;
      const n = position.getCount();
      const pos = new Float64Array(n * 3);
      const p = new Float64Array(3);
      const readPos = reader(position, 3);
      for (let i = 0; i < n; i++) {
        readPos(i, p);
        for (let r = 0; r < 3; r++) {
          pos[i * 3 + r] =
            m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]! + m[12 + r]!;
        }
      }
      const indices = prim.getIndices();
      const idx = indices
        ? Uint32Array.from(indices.getArray() ?? [])
        : Uint32Array.from({ length: n - (n % 3) }, (_, i) => i);
      assertIndicesInRange(idx, n);

      const color = prim.getAttribute("COLOR_0");
      let col: Uint8Array | null = null;
      if (color) {
        col = new Uint8Array(n * 4);
        const c = new Float64Array(4);
        const readColor = reader(color, 4);
        for (let i = 0; i < n; i++) {
          readColor(i, c);
          for (let k = 0; k < 4; k++) {
            col[i * 4 + k] = Math.round(Math.min(1, Math.max(0, c[k]!)) * 255);
          }
        }
      }
      const texcoord = prim.getAttribute("TEXCOORD_0");
      let uv: Float32Array | null = null;
      if (texcoord) {
        uv = new Float32Array(n * 2);
        const t = new Float64Array(2);
        const readUv = reader(texcoord, 2);
        for (let i = 0; i < n; i++) {
          readUv(i, t);
          uv[i * 2] = t[0]!;
          uv[i * 2 + 1] = t[1]!;
        }
      }
      const tex = prim.getMaterial()?.getBaseColorTexture();
      if (tex) textures.add(tex);
      parts.push({ pos, idx, col, uv });
    }
  });

  if (parts.length === 0 || parts.every((q) => q.idx.length === 0)) {
    throw new MeshParseError(
      "The file has no triangle mesh (only points, lines or an empty scene). Export the scan as a mesh.",
      "no_triangles",
    );
  }

  const nv = parts.reduce((s, q) => s + q.pos.length / 3, 0);
  const ni = parts.reduce((s, q) => s + q.idx.length, 0);
  const pos64 = new Float64Array(nv * 3);
  const indices = new Uint32Array(ni);
  const anyColor = parts.some((q) => q.col);
  const allUv = parts.every((q) => q.uv);
  const colors = anyColor ? new Uint8Array(nv * 4).fill(255) : null;
  const uvs = allUv ? new Float32Array(nv * 2) : null;
  let vo = 0;
  let io = 0;
  for (const q of parts) {
    pos64.set(q.pos, vo * 3);
    for (let i = 0; i < q.idx.length; i++) indices[io + i] = q.idx[i]! + vo;
    if (colors && q.col) colors.set(q.col, vo * 4);
    if (uvs && q.uv) uvs.set(q.uv, vo * 2);
    vo += q.pos.length / 3;
    io += q.idx.length;
  }

  const sizes: TextureSize[] = [];
  for (const tex of textures) {
    const image = tex.getImage();
    const size = image ? imageSize(image, tex.getMimeType()) : null;
    if (size) sizes.push(size);
    else missingTextures++;
  }
  const { positions, centre } = centreToFloat32(pos64);
  return {
    format,
    positions,
    indices,
    colors,
    colorSize: 4,
    uvs,
    textures: sizes,
    missingTextures,
    centre,
  };
}
