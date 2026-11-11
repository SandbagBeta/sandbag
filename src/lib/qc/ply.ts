import {
  assertIndicesInRange,
  centreToFloat32,
  MeshParseError,
  type ParsedMesh,
} from "./mesh";

/**
 * PLY reader: ASCII, binary little- and big-endian; any scalar property
 * types; faces as lists (polygons are fan-triangulated); extra elements are
 * skipped. Keeps xyz, vertex colours and uv.
 */

type Scalar =
  | "int8"
  | "uint8"
  | "int16"
  | "uint16"
  | "int32"
  | "uint32"
  | "float32"
  | "float64";

const TYPE_ALIASES: Record<string, Scalar> = {
  char: "int8",
  int8: "int8",
  uchar: "uint8",
  uint8: "uint8",
  short: "int16",
  int16: "int16",
  ushort: "uint16",
  uint16: "uint16",
  int: "int32",
  int32: "int32",
  uint: "uint32",
  uint32: "uint32",
  float: "float32",
  float32: "float32",
  double: "float64",
  float64: "float64",
};

const SIZE: Record<Scalar, number> = {
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  float32: 4,
  float64: 8,
};

interface Property {
  key: string;
  type: Scalar;
  /** Count type for list properties. */
  listType?: Scalar;
}

interface Element {
  key: string;
  count: number;
  props: Property[];
}

export interface PlyHeader {
  format: "ascii" | "binary_little_endian" | "binary_big_endian";
  elements: Element[];
  /** Byte offset of the body. */
  bodyStart: number;
}

const corrupt = (detail: string) =>
  new MeshParseError(
    `The PLY header is damaged (${detail}). Re-export and upload again.`,
    "corrupt",
  );

const truncated = () =>
  new MeshParseError(
    "The file is incomplete or damaged (the mesh data ends early). Re-export and upload again.",
    "truncated",
  );

function scalar(t: string | undefined): Scalar {
  const s = t ? TYPE_ALIASES[t] : undefined;
  if (!s) throw corrupt("unknown property type");
  return s;
}

/** Parses the header only (the first few hundred bytes). */
export function parsePlyHeader(bytes: Uint8Array): PlyHeader {
  const limit = Math.min(bytes.length, 64 * 1024);
  let end = -1;
  for (let i = 0; i + 10 <= limit; i++) {
    if (bytes[i] === 0x65 /* e */ && matches(bytes, i, "end_header")) {
      end = i + 10;
      break;
    }
  }
  if (end < 0) throw corrupt("no end_header");
  if (bytes[end] === 0x0d) end++;
  if (bytes[end] !== 0x0a) throw corrupt("bad end_header line");
  const lines = new TextDecoder("latin1")
    .decode(bytes.subarray(0, end))
    .split(/\r?\n/);

  let format: PlyHeader["format"] | null = null;
  const elements: Element[] = [];
  for (const raw of lines) {
    const t = raw.trim().split(/\s+/);
    if (t[0] === "format") {
      if (
        t[1] === "ascii" ||
        t[1] === "binary_little_endian" ||
        t[1] === "binary_big_endian"
      ) {
        format = t[1];
      } else throw corrupt("unknown format");
    } else if (t[0] === "element") {
      const count = Number(t[2]);
      if (!t[1] || !Number.isSafeInteger(count) || count < 0) {
        throw corrupt("bad element count");
      }
      elements.push({ key: t[1], count, props: [] });
    } else if (t[0] === "property") {
      const el = elements.at(-1);
      if (!el) throw corrupt("property before element");
      if (t[1] === "list") {
        el.props.push({
          key: t[4] ?? "",
          listType: scalar(t[2]),
          type: scalar(t[3]),
        });
      } else {
        el.props.push({ key: t[2] ?? "", type: scalar(t[1]) });
      }
    }
  }
  if (!format) throw corrupt("no format line");
  return { format, elements, bodyStart: end + 1 };
}

function matches(bytes: Uint8Array, at: number, word: string): boolean {
  for (let k = 0; k < word.length; k++) {
    if (bytes[at + k] !== word.charCodeAt(k)) return false;
  }
  return true;
}

/** Face count from the header: a lower bound on triangles (H3 fast-fail). */
export function plyHeaderFaceCount(header: PlyHeader): number {
  return header.elements.find((e) => e.key === "face")?.count ?? 0;
}

/** Reads one number at a time from the body, binary or ASCII. */
interface Reader {
  read(type: Scalar): number;
}

function binaryReader(bytes: Uint8Array, start: number, le: boolean): Reader {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = start;
  return {
    read(type) {
      const size = SIZE[type];
      if (o + size > dv.byteLength) throw truncated();
      let v: number;
      switch (type) {
        case "int8":
          v = dv.getInt8(o);
          break;
        case "uint8":
          v = dv.getUint8(o);
          break;
        case "int16":
          v = dv.getInt16(o, le);
          break;
        case "uint16":
          v = dv.getUint16(o, le);
          break;
        case "int32":
          v = dv.getInt32(o, le);
          break;
        case "uint32":
          v = dv.getUint32(o, le);
          break;
        case "float32":
          v = dv.getFloat32(o, le);
          break;
        case "float64":
          v = dv.getFloat64(o, le);
          break;
      }
      o += size;
      return v;
    },
  };
}

function asciiReader(bytes: Uint8Array, start: number): Reader {
  let o = start;
  return {
    read() {
      while (o < bytes.length && bytes[o]! <= 0x20) o++;
      if (o >= bytes.length) throw truncated();
      const s = o;
      while (o < bytes.length && bytes[o]! > 0x20) o++;
      const v = Number(String.fromCharCode(...bytes.subarray(s, o)));
      if (Number.isNaN(v)) {
        throw new MeshParseError(
          "The PLY file has text where numbers should be, so it's damaged. Re-export and upload again.",
          "corrupt",
        );
      }
      return v;
    },
  };
}

const COLOR_KEYS = [
  ["red", "r", "diffuse_red"],
  ["green", "g", "diffuse_green"],
  ["blue", "b", "diffuse_blue"],
  ["alpha", "a"],
];
const UV_KEYS = [
  ["u", "s", "texture_u", "texture_s"],
  ["v", "t", "texture_v", "texture_t"],
];

function toByte(v: number, type: Scalar): number {
  if (type === "float32" || type === "float64") {
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  if (type === "uint16" || type === "int16") return v >> 8;
  return v & 0xff;
}

export function parsePly(bytes: Uint8Array): ParsedMesh {
  const header = parsePlyHeader(bytes);
  const vertexEl = header.elements.find((e) => e.key === "vertex");
  const faceEl = header.elements.find((e) => e.key === "face");
  if (!vertexEl || !faceEl || faceEl.count === 0) {
    throw new MeshParseError(
      "This PLY has no faces (it's a point cloud or empty). Export a mesh, not a point cloud.",
      "no_triangles",
    );
  }
  const slot = (keys: string[]) =>
    vertexEl.props.findIndex((p) => !p.listType && keys.includes(p.key));
  const xyz = ["x", "y", "z"].map((k) => slot([k]));
  if (xyz.some((i) => i < 0)) throw corrupt("vertices have no x, y, z");
  const rgb = COLOR_KEYS.map(slot);
  const hasColor = rgb[0]! >= 0 && rgb[1]! >= 0 && rgb[2]! >= 0;
  const colorSize = hasColor && rgb[3]! >= 0 ? 4 : 3;
  const uvSlots = UV_KEYS.map(slot);
  const hasUv = uvSlots[0]! >= 0 && uvSlots[1]! >= 0;
  const indexProp = faceEl.props.findIndex(
    (p) =>
      p.listType && (p.key === "vertex_indices" || p.key === "vertex_index"),
  );
  if (indexProp < 0) throw corrupt("faces have no vertex_indices");

  const reader =
    header.format === "ascii"
      ? asciiReader(bytes, header.bodyStart)
      : binaryReader(
          bytes,
          header.bodyStart,
          header.format === "binary_little_endian",
        );

  const nv = vertexEl.count;
  const pos64 = new Float64Array(nv * 3);
  const colors = hasColor ? new Uint8Array(nv * colorSize) : null;
  const uvs = hasUv ? new Float32Array(nv * 2) : null;
  let indices: Uint32Array | null = null;
  const row = new Float64Array(32);

  for (const el of header.elements) {
    if (el === vertexEl) {
      const props = el.props;
      if (props.length > row.length || props.some((p) => p.listType)) {
        throw corrupt("unsupported vertex layout");
      }
      for (let i = 0; i < nv; i++) {
        for (let p = 0; p < props.length; p++) {
          row[p] = reader.read(props[p]!.type);
        }
        for (let k = 0; k < 3; k++) pos64[i * 3 + k] = row[xyz[k]!]!;
        if (colors) {
          for (let k = 0; k < colorSize; k++) {
            colors[i * colorSize + k] = toByte(
              row[rgb[k]!]!,
              props[rgb[k]!]!.type,
            );
          }
        }
        if (uvs) {
          uvs[i * 2] = row[uvSlots[0]!]!;
          uvs[i * 2 + 1] = row[uvSlots[1]!]!;
        }
      }
    } else if (el === faceEl) {
      // Sized for triangles; polygons (fan-triangulated) grow it.
      let buf = new Uint32Array(el.count * 3);
      let n = 0;
      for (let f = 0; f < el.count; f++) {
        for (let p = 0; p < el.props.length; p++) {
          const prop = el.props[p]!;
          if (!prop.listType) {
            reader.read(prop.type);
            continue;
          }
          const len = reader.read(prop.listType);
          if (p !== indexProp || len < 3) {
            for (let k = 0; k < len; k++) reader.read(prop.type);
            continue;
          }
          const first = reader.read(prop.type);
          let prev = reader.read(prop.type);
          for (let k = 2; k < len; k++) {
            const cur = reader.read(prop.type);
            if (n + 3 > buf.length) {
              const grown = new Uint32Array(buf.length * 2 + 3);
              grown.set(buf);
              buf = grown;
            }
            buf[n++] = first;
            buf[n++] = prev;
            buf[n++] = cur;
            prev = cur;
          }
        }
      }
      indices = buf.subarray(0, n);
    } else {
      skipElement(el, reader);
    }
  }

  if (!indices || indices.length === 0) {
    throw new MeshParseError(
      "This PLY has no triangles. Export a mesh, not a point cloud.",
      "no_triangles",
    );
  }
  assertIndicesInRange(indices, nv);
  const { positions, centre } = centreToFloat32(pos64);
  return {
    format: "ply",
    positions,
    indices,
    colors,
    colorSize,
    uvs,
    textures: [],
    missingTextures: 0,
    centre,
  };
}

function skipElement(el: Element, reader: Reader) {
  for (let i = 0; i < el.count; i++) {
    for (const p of el.props) {
      if (p.listType) {
        const len = reader.read(p.listType);
        for (let k = 0; k < len; k++) reader.read(p.type);
      } else reader.read(p.type);
    }
  }
}
