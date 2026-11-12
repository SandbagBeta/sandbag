import type { UploadFailureCode } from "./failureHelp";

/**
 * Client- and server-side checks for a raw scan before anything is uploaded
 * (#15). QC (#16) re-checks magic bytes and parses the mesh; this only
 * rejects what is obviously wrong, with a message a contributor can act on.
 */

/** Matches `uploads` in supabase/config.toml (200MiB). Hosted Free: 50 MB. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export type UploadKind = "glb" | "gltf" | "ply" | "zip";

/**
 * MIME sent as TUS `contentType`. Each must be in the bucket allowlist in
 * supabase/config.toml; PLY has no registered type, so it goes as
 * octet-stream.
 */
export const CONTENT_TYPES: Record<UploadKind, string> = {
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  ply: "application/octet-stream",
  zip: "application/zip",
};

export const ACCEPT_ATTR = ".glb,.gltf,.ply,.zip";

export type FileCheck =
  | { ok: true; kind: UploadKind; contentType: string }
  | { ok: false; error: string; code: UploadFailureCode };

/** Extension after the last dot, lower-cased; "" if none. */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
}

export function checkUploadFile(file: {
  name: string;
  size: number;
}): FileCheck {
  const ext = extensionOf(file.name);
  if (ext === "obj") {
    return {
      ok: false,
      error:
        "OBJ files need their .mtl and textures: zip them together and upload the .zip.",
      code: "obj_needs_zip",
    };
  }
  if (!(ext in CONTENT_TYPES)) {
    return {
      ok: false,
      error: `".${ext || "(none)"}" isn't supported. Upload a .glb, .gltf, .ply, or a .zip with an .obj or .gltf and its textures.`,
      code: "unsupported_file",
    };
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return { ok: false, error: "That file is empty.", code: "empty_file" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `That file is ${formatBytes(file.size)}; the limit is 200 MB.`,
      code: "file_too_large",
    };
  }
  const kind = ext as UploadKind;
  return { ok: true, kind, contentType: CONTENT_TYPES[kind] };
}

/** A zip must hold a mesh we can convert: an .obj or a .gltf. */
export function checkZipEntries(names: readonly string[]): string | null {
  const meshes = names.filter((n) => /\.(obj|gltf)$/i.test(n));
  if (meshes.length === 0) {
    return "The .zip has no .obj or .gltf file inside.";
  }
  return null;
}

/**
 * The stored file name. The contributor's name is dropped entirely: it can
 * hold a boulder or crag name, and ADR 002 §3 keeps those out of keys.
 */
export function storedFileName(kind: UploadKind): string {
  return `source.${kind}`;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
