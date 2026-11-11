import { ImageUtils } from "@gltf-transform/core";
import type { TextureSize } from "./mesh";

/** MIME type from an image's magic bytes; null when it isn't an image we read. */
export function imageMimeType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return "image/png";
  }
  if (
    b.length >= 12 &&
    String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  if (b[0] === 0xab && String.fromCharCode(...b.subarray(1, 7)) === "KTX 20") {
    return "image/ktx2";
  }
  return null;
}

/** Width/height from the image header, without decoding pixels. */
export function imageSize(
  bytes: Uint8Array,
  mimeType?: string,
): TextureSize | null {
  const mime = imageMimeType(bytes) ?? mimeType;
  if (!mime) return null;
  try {
    const size = ImageUtils.getSize(bytes, mime);
    if (!size || !(size[0] > 0) || !(size[1] > 0)) return null;
    return { width: size[0], height: size[1] };
  } catch {
    return null;
  }
}
