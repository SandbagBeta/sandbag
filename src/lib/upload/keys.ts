import { storedFileName, type UploadKind } from "./validate";

/**
 * Raw upload keys (ADR 002 §3): `uploads/{uploader_id}/{scan_id}/raw/source.<ext>`.
 * Built only from ids, so a key never carries a name or a location. The
 * Storage RLS policy `uploads_own_raw_insert` checks exactly this shape.
 */
export const UPLOADS_BUCKET = "uploads";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Object name inside the `uploads` bucket (no bucket prefix). */
export function rawObjectKey(
  uploaderId: string,
  scanId: string,
  kind: UploadKind,
): string {
  if (!isUuid(uploaderId) || !isUuid(scanId)) {
    throw new TypeError("rawObjectKey: uploaderId and scanId must be UUIDs");
  }
  return `${uploaderId.toLowerCase()}/${scanId.toLowerCase()}/raw/${storedFileName(kind)}`;
}

/** Canonical GLB the QC worker writes (ADR 002 §3), in the `uploads` bucket. */
export function derivedGlbKey(
  uploaderId: string,
  scanId: string,
  contentHash: string,
): string {
  if (
    !isUuid(uploaderId) ||
    !isUuid(scanId) ||
    !/^[0-9a-f]{64}$/.test(contentHash)
  ) {
    throw new TypeError("derivedGlbKey: bad id or hash");
  }
  return `${uploaderId.toLowerCase()}/${scanId.toLowerCase()}/derived/${contentHash}.glb`;
}

/** The thumbnail next to it. */
export function derivedThumbKey(uploaderId: string, scanId: string): string {
  if (!isUuid(uploaderId) || !isUuid(scanId)) {
    throw new TypeError("derivedThumbKey: ids must be UUIDs");
  }
  return `${uploaderId.toLowerCase()}/${scanId.toLowerCase()}/derived/thumb.webp`;
}

/** Folder holding a scan's raw file, for listing. */
export function rawFolder(uploaderId: string, scanId: string): string {
  return `${uploaderId.toLowerCase()}/${scanId.toLowerCase()}/raw`;
}

/** Inverse of rawObjectKey; null for anything else. */
export function parseRawObjectKey(
  key: string,
): { uploaderId: string; scanId: string; fileName: string } | null {
  const m = /^([^/]+)\/([^/]+)\/raw\/(source\.(?:glb|gltf|ply|zip))$/.exec(key);
  const [, uploaderId, scanId, fileName] = m ?? [];
  if (!isUuid(uploaderId) || !isUuid(scanId) || !fileName) return null;
  return { uploaderId, scanId, fileName };
}
