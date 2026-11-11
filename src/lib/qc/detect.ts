import type { UploadKind } from "../upload/validate";

/**
 * Magic-byte sniffing (H1). Uploads are stored as `source.<ext>` (ADR 002 §3),
 * so the extension is the kind the contributor chose; this checks the bytes
 * agree, and names common wrong formats so the message is actionable.
 */
export type Sniffed =
  UploadKind | "jpeg" | "png" | "pdf" | "fbx" | "stl" | "obj" | "unknown";

const ascii = (b: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...b.subarray(start, Math.min(end, b.length)));

export function sniff(bytes: Uint8Array): Sniffed {
  const b = bytes;
  const head = ascii(b, 0, 32);
  if (head.startsWith("glTF")) return "glb";
  if (head.startsWith("ply\n") || head.startsWith("ply\r\n")) return "ply";
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5)) {
    return "zip";
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b[0] === 0x89 && head.startsWith("PNG", 1)) return "png";
  if (head.startsWith("%PDF")) return "pdf";
  if (head.startsWith("Kaydara FBX")) return "fbx";
  // Text formats: skip a UTF-8 BOM and leading whitespace.
  let i = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  while (i < b.length && i < 4096 && /\s/.test(String.fromCharCode(b[i]!))) i++;
  if (b[i] === 0x7b /* { */) return "gltf";
  const text = ascii(b, i, i + 256);
  if (text.startsWith("solid ")) return "stl";
  if (/^(#|v |vn |vt |o |g |mtllib )/.test(text)) return "obj";
  return "unknown";
}

const LABEL: Record<Sniffed, string> = {
  glb: "a GLB",
  gltf: "a glTF (.gltf) file",
  ply: "a PLY",
  zip: "a .zip",
  jpeg: "a JPEG image",
  png: "a PNG image",
  pdf: "a PDF",
  fbx: "an FBX",
  stl: "an STL",
  obj: "an OBJ",
  unknown: "a format we recognise",
};

const EXPORT_AS: Record<UploadKind, string> = {
  glb: "Export as GLB again",
  gltf: "Export as glTF again",
  ply: "Export as PLY again",
  zip: "Zip the .obj (or .gltf) with its .mtl and textures and upload the .zip",
};

/** "a GLB", "a PLY", … for messages. */
export const fileTypeLabel = (kind: Sniffed) => LABEL[kind];

/** null when the bytes match `kind`; otherwise a contributor-facing message. */
export function fileTypeMismatch(
  kind: UploadKind,
  sniffed: Sniffed,
): string | null {
  if (sniffed === kind) return null;
  const looks =
    sniffed === "unknown"
      ? "we couldn't recognise its format"
      : `it looks like ${LABEL[sniffed]}`;
  return `This file says .${kind} but isn't ${LABEL[kind]} (${looks}). ${EXPORT_AS[kind]}.`;
}
