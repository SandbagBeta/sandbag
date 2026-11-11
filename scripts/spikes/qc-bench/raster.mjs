// #16 spike (ADR 003): pure-JS z-buffer rasterizer for a flat-shaded,
// untextured thumbnail. Answers "how slow is a no-native-deps thumbnail?".
import { deflateSync } from "node:zlib";

export function renderThumbnail(positions, indices, size = 512) {
  const nv = positions.length / 3;
  // 3/4 view: yaw 35°, pitch -20°, orthographic, fit to bounding sphere.
  const cy = Math.cos(0.61),
    sy = Math.sin(0.61),
    cp = Math.cos(-0.35),
    sp = Math.sin(-0.35);
  const sx = new Float32Array(nv),
    syy = new Float32Array(nv),
    sz = new Float32Array(nv);
  let r = 0,
    mx = 0,
    my = 0,
    mz = 0;
  for (let i = 0; i < nv; i++) {
    mx += positions[i * 3];
    my += positions[i * 3 + 1];
    mz += positions[i * 3 + 2];
  }
  mx /= nv;
  my /= nv;
  mz /= nv;
  for (let i = 0; i < nv; i++) {
    const x = positions[i * 3] - mx,
      y = positions[i * 3 + 1] - my,
      z = positions[i * 3 + 2] - mz;
    const x1 = cy * x + sy * z,
      z1 = -sy * x + cy * z;
    const y2 = cp * y - sp * z1,
      z2 = sp * y + cp * z1;
    sx[i] = x1;
    syy[i] = y2;
    sz[i] = z2;
    r = Math.max(r, Math.hypot(x1, y2, z2));
  }
  const s = (size * 0.48) / r;
  for (let i = 0; i < nv; i++) {
    sx[i] = size / 2 + sx[i] * s;
    syy[i] = size / 2 - syy[i] * s;
    sz[i] *= s;
  }
  const depth = new Float32Array(size * size).fill(-Infinity);
  const px = new Uint8Array(size * size * 3).fill(235);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t],
      b = indices[t + 1],
      c = indices[t + 2];
    const area =
      (sx[b] - sx[a]) * (syy[c] - syy[a]) - (sx[c] - sx[a]) * (syy[b] - syy[a]);
    if (area <= 0) continue; // back-face (screen y is flipped)
    // Face normal in view space for Lambert shading.
    const ux = sx[b] - sx[a],
      uy = syy[b] - syy[a],
      uz = sz[b] - sz[a];
    const vx = sx[c] - sx[a],
      vy = syy[c] - syy[a],
      vz = sz[c] - sz[a];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const shade = Math.round(
      60 +
        160 *
          Math.max(
            0,
            (0.3 * nx - 0.6 * ny + 0.74 * nz) / (Math.hypot(nx, ny, nz) || 1),
          ),
    );
    const x0 = Math.max(0, Math.floor(Math.min(sx[a], sx[b], sx[c]))),
      x1 = Math.min(size - 1, Math.ceil(Math.max(sx[a], sx[b], sx[c])));
    const y0 = Math.max(0, Math.floor(Math.min(syy[a], syy[b], syy[c]))),
      y1 = Math.min(size - 1, Math.ceil(Math.max(syy[a], syy[b], syy[c])));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const w0 =
          ((sx[b] - x) * (syy[c] - y) - (sx[c] - x) * (syy[b] - y)) / area;
        const w1 =
          ((sx[c] - x) * (syy[a] - y) - (sx[a] - x) * (syy[c] - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * sz[a] + w1 * sz[b] + w2 * sz[c],
          p = y * size + x;
        if (z <= depth[p]) continue;
        depth[p] = z;
        px[p * 3] = shade;
        px[p * 3 + 1] = Math.round(shade * 0.95);
        px[p * 3 + 2] = Math.round(shade * 0.88);
      }
  }
  return encodePng(px, size);
}

function encodePng(rgb, size) {
  const row = size * 3 + 1,
    raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++)
    raw.set(rgb.subarray(y * size * 3, (y + 1) * size * 3), y * row + 1);
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let table;
function crc32(buf) {
  table ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
