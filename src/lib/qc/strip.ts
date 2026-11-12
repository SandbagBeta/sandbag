/**
 * Removes metadata (EXIF incl. GPS, XMP, text chunks, comments) from texture
 * bytes without re-encoding the pixels: lossless and deterministic, so the
 * canonical GLB's hash stays stable (ADR 003 O10). Colour-critical data (the
 * JPEG ICC profile and Adobe marker, PNG colour chunks) is kept.
 */
const u32 = (b: Uint8Array, o: number) =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const ascii = (b: Uint8Array, o: number, n: number) =>
  String.fromCharCode(...b.subarray(o, o + n));

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** APPn and COM segments carry metadata; ICC (APP2) and Adobe (APP14) don't. */
function jpegSegmentIsMetadata(
  b: Uint8Array,
  marker: number,
  at: number,
): boolean {
  if (marker === 0xfe) return true;
  if (marker < 0xe1 || marker > 0xef) return false;
  if (marker === 0xee) return false;
  if (marker === 0xe2) return ascii(b, at + 4, 11) !== "ICC_PROFILE";
  return true;
}

function stripJpeg(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) throw new Error("bad jpeg");
    const marker = b[o + 1]!;
    if (marker === 0xda) break; // start of scan: the rest is pixel data
    const len = (b[o + 2]! << 8) | b[o + 3]!;
    if (len < 2 || o + 2 + len > b.length) throw new Error("bad jpeg");
    if (!jpegSegmentIsMetadata(b, marker, o)) {
      parts.push(b.subarray(o, o + 2 + len));
    }
    o += 2 + len;
  }
  parts.push(b.subarray(o));
  return concat(parts);
}

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let o = 8;
  while (o + 12 <= b.length) {
    const end = o + 12 + u32(b, o);
    if (end > b.length) throw new Error("bad png");
    if (!PNG_DROP.has(ascii(b, o + 4, 4))) parts.push(b.subarray(o, end));
    o = end;
  }
  return concat(parts);
}

function stripWebp(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [b.slice(0, 12)];
  let o = 12;
  while (o + 8 <= b.length) {
    const len =
      (b[o + 4]! | (b[o + 5]! << 8) | (b[o + 6]! << 16) | (b[o + 7]! << 24)) >>>
      0;
    const end = o + 8 + len + (len & 1);
    if (end > b.length + 1) throw new Error("bad webp");
    const id = ascii(b, o, 4);
    if (id !== "EXIF" && id !== "XMP ") {
      const chunk = b.slice(o, Math.min(end, b.length));
      if (id === "VP8X") chunk[8] = chunk[8]! & ~0x0c; // EXIF and XMP flags
      parts.push(chunk);
    }
    o = end;
  }
  const out = concat(parts);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

/** Returns the image without metadata; throws on bytes it can't walk. */
export function stripImageMetadata(
  bytes: Uint8Array,
  mime: string,
): Uint8Array {
  if (mime === "image/jpeg") return stripJpeg(bytes);
  if (mime === "image/png") return stripPng(bytes);
  if (mime === "image/webp") return stripWebp(bytes);
  return bytes; // KTX2 carries no EXIF
}
