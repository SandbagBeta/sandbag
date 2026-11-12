import sharp from "sharp";

/**
 * Flat-shaded 3/4-view thumbnail (ADR 003 O5): a pure-JS z-buffer rasterizer
 * (the spike's, 0.2 to 0.5 s at 2M to 5M triangles) renders pixels and `sharp`
 * (prebuilt, ships with Next) encodes WebP. Untextured: texture sampling is a
 * follow-up. Input is the canonical mesh, so the view never shows a location.
 */
export function renderThumbnailRgb(
  positions: Float32Array,
  indices: Uint32Array,
  size = 512,
): Uint8Array {
  const nv = positions.length / 3;
  const cy = Math.cos(0.61);
  const sy = Math.sin(0.61);
  const cp = Math.cos(-0.35);
  const sp = Math.sin(-0.35);
  const sx = new Float32Array(nv);
  const syy = new Float32Array(nv);
  const sz = new Float32Array(nv);
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < nv; i++) {
    mx += positions[i * 3]!;
    my += positions[i * 3 + 1]!;
    mz += positions[i * 3 + 2]!;
  }
  mx /= nv;
  my /= nv;
  mz /= nv;
  let r = 0;
  for (let i = 0; i < nv; i++) {
    const x = positions[i * 3]! - mx;
    const y = positions[i * 3 + 1]! - my;
    const z = positions[i * 3 + 2]! - mz;
    const x1 = cy * x + sy * z;
    const z1 = -sy * x + cy * z;
    sx[i] = x1;
    syy[i] = cp * y - sp * z1;
    sz[i] = sp * y + cp * z1;
    r = Math.max(r, Math.hypot(x1, syy[i]!, sz[i]!));
  }
  const s = (size * 0.48) / (r || 1);
  for (let i = 0; i < nv; i++) {
    sx[i] = size / 2 + sx[i]! * s;
    syy[i] = size / 2 - syy[i]! * s;
    sz[i] = sz[i]! * s;
  }
  const depth = new Float32Array(size * size).fill(-Infinity);
  const px = new Uint8Array(size * size * 3).fill(235);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    const area =
      (sx[b]! - sx[a]!) * (syy[c]! - syy[a]!) -
      (sx[c]! - sx[a]!) * (syy[b]! - syy[a]!);
    if (area <= 0) continue; // back-face (screen y is flipped)
    const ux = sx[b]! - sx[a]!;
    const uy = syy[b]! - syy[a]!;
    const uz = sz[b]! - sz[a]!;
    const vx = sx[c]! - sx[a]!;
    const vy = syy[c]! - syy[a]!;
    const vz = sz[c]! - sz[a]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const lambert = Math.max(
      0,
      (0.3 * nx - 0.6 * ny + 0.74 * nz) / (Math.hypot(nx, ny, nz) || 1),
    );
    const shade = Math.round(60 + 160 * lambert);
    const x0 = Math.max(0, Math.floor(Math.min(sx[a]!, sx[b]!, sx[c]!)));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(sx[a]!, sx[b]!, sx[c]!)));
    const y0 = Math.max(0, Math.floor(Math.min(syy[a]!, syy[b]!, syy[c]!)));
    const y1 = Math.min(
      size - 1,
      Math.ceil(Math.max(syy[a]!, syy[b]!, syy[c]!)),
    );
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const w0 =
          ((sx[b]! - x) * (syy[c]! - y) - (sx[c]! - x) * (syy[b]! - y)) / area;
        const w1 =
          ((sx[c]! - x) * (syy[a]! - y) - (sx[a]! - x) * (syy[c]! - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * sz[a]! + w1 * sz[b]! + w2 * sz[c]!;
        const p = y * size + x;
        if (z <= depth[p]!) continue;
        depth[p] = z;
        px[p * 3] = shade;
        px[p * 3 + 1] = Math.round(shade * 0.95);
        px[p * 3 + 2] = Math.round(shade * 0.88);
      }
    }
  }
  return px;
}

/** 512 px WebP of the mesh. Raw pixels in, so no metadata can ride along. */
export async function renderThumbnailWebp(
  positions: Float32Array,
  indices: Uint32Array,
  size = 512,
): Promise<Uint8Array> {
  const rgb = renderThumbnailRgb(positions, indices, size);
  const out = await sharp(rgb, {
    raw: { width: size, height: size, channels: 3 },
  })
    .webp({ quality: 80 })
    .toBuffer();
  return new Uint8Array(out);
}
