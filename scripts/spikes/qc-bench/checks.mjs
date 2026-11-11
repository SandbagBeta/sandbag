// #16 spike (ADR 003): prototype PRD §9 geometry checks over plain typed
// arrays. Not production code; thresholds are the PRD's, messages omitted.

/** Minimal binary_little_endian PLY reader: float xyz + list uchar int faces. */
export function parsePly(bytes) {
  const end = bytes.indexOf("end_header\n");
  if (end < 0) throw new Error("no PLY header");
  const header = bytes.subarray(0, end).toString("latin1").split("\n");
  if (!header.includes("format binary_little_endian 1.0"))
    throw new Error("only binary_little_endian PLY in this spike");
  const nv = Number(
    header.find((l) => l.startsWith("element vertex")).split(" ")[2],
  );
  const nf = Number(
    header.find((l) => l.startsWith("element face")).split(" ")[2],
  );
  const vProps = header.filter(
    (l, i) =>
      l.startsWith("property") &&
      i < header.findIndex((h) => h.startsWith("element face")),
  );
  const stride = vProps.reduce(
    (s, l) => s + { float: 4, uchar: 1, int: 4 }[l.split(" ")[1]],
    0,
  );
  const dv = new DataView(bytes.buffer, bytes.byteOffset + end + 11);
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++)
    for (let k = 0; k < 3; k++)
      positions[i * 3 + k] = dv.getFloat32(i * stride + k * 4, true);
  const indices = new Uint32Array(nf * 3);
  let o = nv * stride;
  for (let f = 0; f < nf; f++) {
    if (dv.getUint8(o) !== 3) throw new Error("non-triangle face");
    for (let k = 0; k < 3; k++)
      indices[f * 3 + k] = dv.getInt32(o + 1 + k * 4, true);
    o += 13;
  }
  return { positions, indices };
}

/** Vertex id → canonical id for vertices at the same position (UV seams). */
export function weldByPosition(positions, eps = 1e-5) {
  const n = positions.length / 3;
  let size = 1;
  while (size < n * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1);
  const q = new Int32Array(n * 3);
  const canon = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++)
      q[i * 3 + k] = Math.round(positions[i * 3 + k] / eps);
    let h =
      Math.imul(q[i * 3], 73856093) ^
      Math.imul(q[i * 3 + 1], 19349663) ^
      Math.imul(q[i * 3 + 2], 83492791);
    h &= size - 1;
    for (;;) {
      const j = table[h];
      if (j < 0) {
        table[h] = i;
        canon[i] = i;
        break;
      }
      if (
        q[j * 3] === q[i * 3] &&
        q[j * 3 + 1] === q[i * 3 + 1] &&
        q[j * 3 + 2] === q[i * 3 + 2]
      ) {
        canon[i] = j;
        break;
      }
      h = (h + 1) & (size - 1);
    }
  }
  return canon;
}

export function geometryChecks(positions, indices) {
  const nv = positions.length / 3,
    nt = indices.length / 3;
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  const extent = max.map((m, k) => m - min[k]);
  const canon = weldByPosition(positions);
  // Degenerate faces + signed volume (divergence theorem).
  let degenerate = 0,
    volume = 0;
  const edges = new Float64Array(nt * 3);
  const parent = new Uint32Array(nv).map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let t = 0; t < nt; t++) {
    const a = canon[indices[t * 3]],
      b = canon[indices[t * 3 + 1]],
      c = canon[indices[t * 3 + 2]];
    const ax = positions[a * 3],
      ay = positions[a * 3 + 1],
      az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax,
      uy = positions[b * 3 + 1] - ay,
      uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax,
      vy = positions[c * 3 + 1] - ay,
      vz = positions[c * 3 + 2] - az;
    const cx = uy * vz - uz * vy,
      cy = uz * vx - ux * vz,
      cz = ux * vy - uy * vx;
    if (a === b || b === c || a === c || cx * cx + cy * cy + cz * cz < 1e-24)
      degenerate++;
    volume += (ax * cx + ay * cy + az * cz) / 6;
    const tri = [a, b, c];
    for (let k = 0; k < 3; k++) {
      const p = tri[k],
        r = tri[(k + 1) % 3];
      edges[t * 3 + k] = p < r ? p * nv + r : r * nv + p; // < 2^53 up to ~94M verts
    }
    const ra = find(a),
      rb = find(b),
      rc = find(c);
    parent[rb] = ra;
    parent[find(rc)] = ra;
  }
  edges.sort();
  let boundary = 0,
    nonManifold = 0;
  for (let i = 0; i < edges.length;) {
    let j = i + 1;
    while (j < edges.length && edges[j] === edges[i]) j++;
    if (j - i === 1) boundary++;
    else if (j - i > 2) nonManifold++;
    i = j;
  }
  // Floaters: vertices outside the largest connected component.
  const compSize = new Uint32Array(nv);
  let used = 0;
  for (let i = 0; i < nv; i++)
    if (canon[i] === i) {
      compSize[find(i)]++;
      used++;
    }
  let largest = 0;
  for (let i = 0; i < nv; i++) if (compSize[i] > largest) largest = compSize[i];
  return {
    triCount: nt,
    extent,
    boundsOk: Math.max(...extent) >= 0.3 && Math.max(...extent) <= 30,
    volume: Math.abs(volume),
    degenerate,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    floaterFraction: used ? 1 - largest / used : 0,
  };
}

/** Width/height from PNG or JPEG bytes without decoding pixels. */
export function imageSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50)
    return { w: readU32BE(b, 16), h: readU32BE(b, 20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let o = 2; o < b.length;) {
      const m = b[o + 1],
        len = (b[o + 2] << 8) | b[o + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { h: (b[o + 5] << 8) | b[o + 6], w: (b[o + 7] << 8) | b[o + 8] };
      o += 2 + len;
    }
  }
  return null;
}
const readU32BE = (b, o) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
