// Procedural boulder geometry. Pure functions, no I/O. The noise path uses
// integer hashing only (no Math.sin/cos) so the same seed yields bit-identical
// vertices on every platform. Units: meters, Y-up, ground plane at y = 0.

/** Integer hash → float in [0, 1). Deterministic across JS engines. */
function hash3(ix, iy, iz, seed) {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 97) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Trilinear value noise in [0, 1). */
function valueNoise(x, y, z, seed) {
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    z0 = Math.floor(z);
  const tx = smooth(x - x0),
    ty = smooth(y - y0),
    tz = smooth(z - z0);
  let result = 0;
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
        result += w * hash3(x0 + dx, y0 + dy, z0 + dz, seed);
      }
    }
  }
  return result;
}

/** Fractal value noise, roughly in [-1, 1]. */
export function fbm(x, y, z, seed, octaves = 4) {
  let amp = 1,
    freq = 1,
    sum = 0,
    norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum +=
      amp * (valueNoise(x * freq, y * freq, z * freq, seed + o * 1013) * 2 - 1);
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

export const DEFAULT_PARAMS = Object.freeze({
  seed: 8, // the issue number
  resolution: 72, // grid cells per cube face → 6 * res^2 * 2 triangles
  radii: [1.17, 1.1, 0.9], // ellipsoid semi-axes (x, y, z) in meters
  displacement: 0.16, // max radial noise displacement in meters
  noiseScale: 1.6, // noise frequency (per meter)
  floorY: -0.6, // below this the boulder is squashed toward a flat base
});

/**
 * Builds a shared-vertex cube-sphere, displaces it with seeded noise, flattens
 * the base and rests it on y = 0 centered on the x/z origin.
 *
 * @returns {{ positions: Float32Array, normals: Float32Array, colors: Float32Array, indices: Uint32Array }}
 */
export function generateBoulder(params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const n = p.resolution;
  const vertexIndex = new Map();
  const pos = [];

  // Cube-sphere: normalize points on a cube's surface. Edge/corner vertices
  // are deduplicated by their integer cube coordinate so the mesh is watertight.
  const addVertex = (a, b, c) => {
    const k = `${a},${b},${c}`;
    let idx = vertexIndex.get(k);
    if (idx === undefined) {
      idx = pos.length / 3;
      vertexIndex.set(k, idx);
      let x = a / n - 0.5,
        y = b / n - 0.5,
        z = c / n - 0.5;
      const len = Math.sqrt(x * x + y * y + z * z);
      x /= len;
      y /= len;
      z /= len;
      pos.push(x, y, z);
    }
    return idx;
  };

  // Each face maps grid (i, j) to integer cube coords in [0, n]^3.
  const faces = [
    (i, j) => [n, i, j],
    (i, j) => [0, j, i],
    (i, j) => [i, n, j],
    (i, j) => [j, 0, i],
    (i, j) => [j, i, n],
    (i, j) => [i, j, 0],
  ];
  const idx = [];
  for (const f of faces) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v00 = addVertex(...f(i, j));
        const v10 = addVertex(...f(i + 1, j));
        const v01 = addVertex(...f(i, j + 1));
        const v11 = addVertex(...f(i + 1, j + 1));
        idx.push(v00, v10, v11, v00, v11, v01);
      }
    }
  }

  // Displace unit-sphere points: ellipsoid scale + radial noise + squashed base.
  const count = pos.length / 3;
  const positions = new Float32Array(pos.length);
  const [rx, ry, rz] = p.radii;
  for (let i = 0; i < count; i++) {
    const ux = pos[i * 3],
      uy = pos[i * 3 + 1],
      uz = pos[i * 3 + 2];
    const noise = fbm(
      ux * rx * p.noiseScale + 11.3,
      uy * ry * p.noiseScale + 7.9,
      uz * rz * p.noiseScale + 3.1,
      p.seed,
    );
    const d = 1 + (noise * p.displacement) / Math.min(rx, ry, rz);
    let y = uy * ry * d;
    if (y < p.floorY) y = p.floorY + (y - p.floorY) * 0.12;
    positions[i * 3] = ux * rx * d;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = uz * rz * d;
  }

  const indices = new Uint32Array(idx);
  fixWinding(positions, indices);
  recenter(positions);
  const normals = computeVertexNormals(positions, indices);
  const colors = rockColors(positions, normals, p.seed);
  return { positions, normals, colors, indices };
}

/** Ensure every triangle faces outward (away from the origin). */
function fixWinding(positions, indices) {
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3,
      b = indices[t + 1] * 3,
      c = indices[t + 2] * 3;
    const n = faceNormal(positions, a, b, c);
    const cx = positions[a] + positions[b] + positions[c];
    const cy = positions[a + 1] + positions[b + 1] + positions[c + 1];
    const cz = positions[a + 2] + positions[b + 2] + positions[c + 2];
    if (n[0] * cx + n[1] * cy + n[2] * cz < 0) {
      const tmp = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = tmp;
    }
  }
}

function faceNormal(p, a, b, c) {
  const abx = p[b] - p[a],
    aby = p[b + 1] - p[a + 1],
    abz = p[b + 2] - p[a + 2];
  const acx = p[c] - p[a],
    acy = p[c + 1] - p[a + 1],
    acz = p[c + 2] - p[a + 2];
  return [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
}

/** Translate so x/z are centered on the origin and min y sits on the ground. */
function recenter(positions) {
  const b = bounds(positions);
  const dx = (b.min[0] + b.max[0]) / 2,
    dz = (b.min[2] + b.max[2]) / 2,
    dy = b.min[1];
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= dx;
    positions[i + 1] -= dy;
    positions[i + 2] -= dz;
  }
}

export function bounds(positions) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  return { min, max };
}

export function computeVertexNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3,
      b = indices[t + 1] * 3,
      c = indices[t + 2] * 3;
    const n = faceNormal(positions, a, b, c); // area-weighted
    for (const v of [a, b, c]) {
      normals[v] += n[0];
      normals[v + 1] += n[1];
      normals[v + 2] += n[2];
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len;
    normals[i + 1] /= len;
    normals[i + 2] /= len;
  }
  return normals;
}

/** Grey-brown granite-ish vertex colors, a little lichen-green on top faces. */
function rockColors(positions, normals, seed) {
  const colors = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const grain = fbm(
      positions[i] * 9,
      positions[i + 1] * 9,
      positions[i + 2] * 9,
      seed + 500,
      3,
    );
    const base = 0.42 + grain * 0.1;
    const up = Math.max(0, normals[i + 1]);
    colors[i] = base + 0.04 - up * 0.08;
    colors[i + 1] = base + 0.02 + up * 0.04;
    colors[i + 2] = base - 0.03 - up * 0.1;
  }
  return colors;
}
