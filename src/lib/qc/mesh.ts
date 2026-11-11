/**
 * The parsers' common output: one triangle soup per scan, in metres.
 *
 * Positions are stored relative to the bounding-box centre, computed in
 * double precision before narrowing to float32. A georeferenced scan (UTM or
 * ECEF offsets in the millions) would otherwise lose ~0.5 m of precision in
 * float32. The subtracted centre is internal: it is a location, so it never
 * goes into a report, a log or an error (ADR 003 §5, O10).
 */
export type MeshFormat = "glb" | "gltf" | "ply" | "obj";

export interface TextureSize {
  width: number;
  height: number;
}

export interface ParsedMesh {
  format: MeshFormat;
  /** xyz per vertex, metres, relative to `centre`. */
  positions: Float32Array;
  /** Three vertex indices per triangle. */
  indices: Uint32Array;
  /** RGB(A) per vertex, 0–255, when the file has vertex colours. */
  colors: Uint8Array | null;
  /** Components per colour in `colors` (3 or 4). */
  colorSize: number;
  /** uv per vertex when the file has texture coordinates. */
  uvs: Float32Array | null;
  /** Size of each image texture used as base colour. */
  textures: TextureSize[];
  /** Base-colour textures the file names but doesn't contain. */
  missingTextures: number;
  /** Internal only (never reported): the bbox centre subtracted from positions. */
  centre: readonly [number, number, number];
}

/** Malformed input: the message is contributor-facing and fixed (never file text). */
export class MeshParseError extends Error {
  constructor(
    message: string,
    readonly reason:
      "corrupt" | "truncated" | "no_triangles" | "unsupported" | "too_large",
  ) {
    super(message);
    this.name = "MeshParseError";
  }
}

/**
 * Narrows double-precision positions to float32 around their bbox centre.
 * `source` is xyz per vertex in metres.
 */
export function centreToFloat32(source: ArrayLike<number>): {
  positions: Float32Array;
  centre: [number, number, number];
} {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < source.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = source[i + k]!;
      if (!Number.isFinite(v)) {
        throw new MeshParseError(
          "Some vertex positions aren't valid numbers, so the file is damaged. Re-export and upload again.",
          "corrupt",
        );
      }
      if (v < lo[k]!) lo[k] = v;
      if (v > hi[k]!) hi[k] = v;
    }
  }
  const centre: [number, number, number] =
    source.length === 0
      ? [0, 0, 0]
      : ([0, 1, 2].map((k) => (lo[k]! + hi[k]!) / 2) as [
          number,
          number,
          number,
        ]);
  const positions = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 3) {
    for (let k = 0; k < 3; k++) positions[i + k] = source[i + k]! - centre[k]!;
  }
  return { positions, centre };
}

/** Checks every index is in range; corrupt files otherwise crash later checks. */
export function assertIndicesInRange(
  indices: Uint32Array,
  vertexCount: number,
): void {
  for (let i = 0; i < indices.length; i++) {
    if (indices[i]! >= vertexCount) {
      throw new MeshParseError(
        "Some faces point at vertices that don't exist, so the file is damaged. Re-export and upload again.",
        "corrupt",
      );
    }
  }
}
