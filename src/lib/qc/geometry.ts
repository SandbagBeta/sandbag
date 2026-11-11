import type { ParsedMesh } from "./mesh";
import { WELD_EPSILON_M } from "./thresholds";

/**
 * One pass of mesh measurements for the §8 geometry checks. Vertices at the
 * same position are welded first, so UV seams (split vertices) don't count
 * as boundaries or as separate floating pieces.
 */
export interface MeshStats {
  triCount: number;
  /** Bounding-box size along x, y, z in metres (extents, never corners). */
  extents: [number, number, number];
  /** |enclosed volume| / bounding-box volume; 0 for a flat mesh. */
  volumeRatio: number;
  /** Fraction of referenced (welded) vertices outside the largest piece. */
  floaterFraction: number;
  degenerateFaces: number;
  edges: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
}

/** Vertex → canonical vertex at the same (quantized) position. */
export function weldByPosition(
  positions: Float32Array,
  eps = WELD_EPSILON_M,
): Uint32Array {
  const n = positions.length / 3;
  let size = 1;
  while (size < n * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1);
  const q = new Int32Array(n * 3);
  const canon = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      q[i * 3 + k] = Math.round(positions[i * 3 + k]! / eps);
    }
    let h =
      Math.imul(q[i * 3]!, 73856093) ^
      Math.imul(q[i * 3 + 1]!, 19349663) ^
      Math.imul(q[i * 3 + 2]!, 83492791);
    h &= size - 1;
    for (;;) {
      const j = table[h]!;
      if (j < 0) {
        table[h] = i;
        canon[i] = i;
        break;
      }
      if (
        q[j * 3]! === q[i * 3]! &&
        q[j * 3 + 1]! === q[i * 3 + 1]! &&
        q[j * 3 + 2]! === q[i * 3 + 2]!
      ) {
        canon[i] = j;
        break;
      }
      h = (h + 1) & (size - 1);
    }
  }
  return canon;
}

export function measureMesh(mesh: ParsedMesh): MeshStats {
  const { positions: P, indices } = mesh;
  const nv = P.length / 3;
  const nt = indices.length / 3;

  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < indices.length; t++) {
    const i = indices[t]! * 3;
    for (let k = 0; k < 3; k++) {
      const v = P[i + k]!;
      if (v < lo[k]!) lo[k] = v;
      if (v > hi[k]!) hi[k] = v;
    }
  }
  const extents = [0, 1, 2].map((k) =>
    nt ? hi[k]! - lo[k]! : 0,
  ) as MeshStats["extents"];
  // Volume is taken about the bbox centre: for an open scan (no base) that
  // keeps it meaningful, and for a flat mesh the centre lies in its plane.
  const ref = [0, 1, 2].map((k) => (nt ? (lo[k]! + hi[k]!) / 2 : 0));

  const canon = weldByPosition(P);
  const parent = new Uint32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x: number) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]!]!;
    return x;
  };

  let degenerate = 0;
  let volume = 0;
  const edgeKeys = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = canon[indices[t * 3]!]!;
    const b = canon[indices[t * 3 + 1]!]!;
    const c = canon[indices[t * 3 + 2]!]!;
    const ax = P[a * 3]! - ref[0]!;
    const ay = P[a * 3 + 1]! - ref[1]!;
    const az = P[a * 3 + 2]! - ref[2]!;
    const ux = P[b * 3]! - P[a * 3]!;
    const uy = P[b * 3 + 1]! - P[a * 3 + 1]!;
    const uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
    const vx = P[c * 3]! - P[a * 3]!;
    const vy = P[c * 3 + 1]! - P[a * 3 + 1]!;
    const vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    if (a === b || b === c || a === c || cx * cx + cy * cy + cz * cz < 1e-24) {
      degenerate++;
    }
    volume += (ax * cx + ay * cy + az * cz) / 6;
    const tri = [a, b, c];
    for (let k = 0; k < 3; k++) {
      const p = tri[k]!;
      const r = tri[(k + 1) % 3]!;
      // Exact below 2^53, i.e. up to ~94M vertices.
      edgeKeys[t * 3 + k] = p < r ? p * nv + r : r * nv + p;
    }
    const ra = find(a);
    parent[find(b)] = ra;
    parent[find(c)] = ra;
  }

  edgeKeys.sort();
  let edges = 0;
  let boundary = 0;
  let nonManifold = 0;
  for (let i = 0; i < edgeKeys.length;) {
    let j = i + 1;
    while (j < edgeKeys.length && edgeKeys[j]! === edgeKeys[i]!) j++;
    edges++;
    if (j - i === 1) boundary++;
    else if (j - i > 2) nonManifold++;
    i = j;
  }

  // Floaters: referenced canonical vertices outside the largest piece.
  const referenced = new Uint8Array(nv);
  for (let t = 0; t < indices.length; t++) referenced[canon[indices[t]!]!] = 1;
  const compSize = new Uint32Array(nv);
  let used = 0;
  for (let i = 0; i < nv; i++) {
    if (referenced[i]!) {
      compSize[find(i)]!++;
      used++;
    }
  }
  let largest = 0;
  for (let i = 0; i < nv; i++)
    if (compSize[i]! > largest) largest = compSize[i]!;

  const boxVolume = extents[0]! * extents[1]! * extents[2]!;
  return {
    triCount: nt,
    extents,
    volumeRatio: boxVolume > 0 ? Math.abs(volume) / boxVolume : 0,
    floaterFraction: used ? 1 - largest / used : 0,
    degenerateFaces: degenerate,
    edges,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
  };
}
