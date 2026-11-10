// Surface sampling + validation on flat indexed geometry
// ({ positions: Float32Array, normals?: Float32Array, indices: Uint32Array|Uint16Array }).
// Holds anchor to (position, normal, face_index) on the canonical GLB (PRD §7),
// so both sampling (generator) and checking (tests, future QC) live here.

function faceCorners(geometry, faceIndex) {
  const { positions, indices } = geometry;
  const out = [];
  for (let k = 0; k < 3; k++) {
    const v = indices[faceIndex * 3 + k] * 3;
    out.push([positions[v], positions[v + 1], positions[v + 2]]);
  }
  return out;
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Unit face normal for the triangle at `faceIndex` (winding order). */
export function faceNormal(geometry, faceIndex) {
  const [a, b, c] = faceCorners(geometry, faceIndex);
  return normalize(cross(sub(b, a), sub(c, a)));
}

export function faceCentroid(geometry, faceIndex) {
  const [a, b, c] = faceCorners(geometry, faceIndex);
  return [
    (a[0] + b[0] + c[0]) / 3,
    (a[1] + b[1] + c[1]) / 3,
    (a[2] + b[2] + c[2]) / 3,
  ];
}

/**
 * Face whose centroid is nearest to `target`; returns a surface anchor
 * ({ position, normal, face_index }) with values rounded to 0.1 mm so the
 * JSON stays compact and stable.
 */
export function nearestSurfacePoint(geometry, target) {
  const triCount = geometry.indices.length / 3;
  let best = -1,
    bestDist = Infinity;
  for (let f = 0; f < triCount; f++) {
    const c = faceCentroid(geometry, f);
    const d = dot(sub(c, target), sub(c, target));
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  const round = (v) => v.map((x) => Math.round(x * 10000) / 10000);
  return {
    position: round(faceCentroid(geometry, best)),
    normal: round(faceNormal(geometry, best)),
    face_index: best,
  };
}

/**
 * Distance from `point` to the triangle `faceIndex`: the out-of-plane distance
 * plus any amount the in-plane projection falls outside the triangle. 0 means
 * the point lies on that face.
 */
export function distanceToFace(geometry, faceIndex, point) {
  const [a, b, c] = faceCorners(geometry, faceIndex);
  const n = faceNormal(geometry, faceIndex);
  const planeDist = dot(sub(point, a), n);
  // Barycentric coordinates of the projected point.
  const v0 = sub(b, a),
    v1 = sub(c, a),
    v2 = sub(point, a);
  const d00 = dot(v0, v0),
    d01 = dot(v0, v1),
    d11 = dot(v1, v1),
    d20 = dot(v2, v0),
    d21 = dot(v2, v1);
  const denom = d00 * d11 - d01 * d01 || 1;
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;
  const outside = Math.max(0, -u, -v, -w);
  // Scale barycentric overshoot by the longest edge to get meters.
  const edge = Math.sqrt(Math.max(d00, d11));
  return Math.abs(planeDist) + outside * edge;
}
