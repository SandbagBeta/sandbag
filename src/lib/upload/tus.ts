import type { DetailedError, UploadOptions } from "tus-js-client";
import { UPLOADS_BUCKET } from "./keys";

/**
 * Supabase Storage resumable uploads (TUS). Supabase requires exactly 6 MB
 * chunks: https://supabase.com/docs/guides/storage/uploads/resumable-uploads
 */
export const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
export const TUS_RETRY_DELAYS = [0, 1000, 3000, 5000, 10000, 20000];

/**
 * Hosted projects should use the direct storage host
 * (`<ref>.storage.supabase.co`); local and self-hosted URLs are kept as is.
 */
export function tusEndpoint(supabaseUrl: string): string {
  const url = new URL(supabaseUrl);
  const hosted = /^([a-z0-9]+)\.supabase\.co$/.exec(url.hostname);
  if (hosted) url.hostname = `${hosted[1]}.storage.supabase.co`;
  return `${url.origin}/storage/v1/upload/resumable`;
}

type FileLike = {
  name: string;
  size: number;
  type?: string;
  lastModified?: number;
};

/**
 * Resume key in localStorage. Independent of the scan id so a reload can
 * find the earlier upload (and its scan, from the stored objectName) before
 * creating a new scan row. Scoped per user and per endpoint.
 */
export function uploadFingerprint(
  userId: string,
  endpoint: string,
  file: FileLike,
): string {
  return [
    "sandbag-upload",
    userId,
    endpoint,
    file.name,
    file.type ?? "",
    file.size,
    file.lastModified ?? 0,
  ].join(":");
}

const AUTH_RETRIES = 2;

/**
 * Retry network drops, 5xx, lock/conflict and rate-limit responses. Retry an
 * auth failure a couple of times, since `onBeforeRequest` fetches a fresh
 * token for the next attempt. Never retry other 4xx (RLS denial, too large,
 * bad MIME): repeating those cannot succeed.
 */
export function shouldRetryUpload(
  err: DetailedError,
  attempt: number,
): boolean {
  const res = err.originalResponse;
  const status = res ? res.getStatus() : 0;
  if (status === 0 || status >= 500) return true;
  if (status === 409 || status === 423 || status === 429) return true;
  const body = res?.getBody() ?? "";
  const authFailure =
    status === 401 ||
    ((status === 400 || status === 403) && /jwt|token|exp/i.test(body));
  return authFailure && attempt < AUTH_RETRIES;
}

export interface TusConfig {
  supabaseUrl: string;
  anonKey: string;
  userId: string;
  objectName: string;
  contentType: string;
  /** Current access token; refreshed by supabase-js when it has expired. */
  getAccessToken: () => Promise<string | null>;
}

export function buildTusOptions(cfg: TusConfig): UploadOptions {
  const endpoint = tusEndpoint(cfg.supabaseUrl);
  return {
    endpoint,
    chunkSize: TUS_CHUNK_SIZE,
    retryDelays: TUS_RETRY_DELAYS,
    uploadDataDuringCreation: true,
    storeFingerprintForResuming: true,
    removeFingerprintOnSuccess: true,
    fingerprint: async (file) =>
      uploadFingerprint(cfg.userId, endpoint, file as unknown as FileLike),
    headers: {
      apikey: cfg.anonKey,
      // Never overwrite: #57 grants contributors insert + select only.
      "x-upsert": "false",
    },
    metadata: {
      bucketName: UPLOADS_BUCKET,
      objectName: cfg.objectName,
      contentType: cfg.contentType,
      cacheControl: "3600",
    },
    // Set per request, not once, so a token refreshed during a long upload
    // is picked up by the next chunk or retry.
    onBeforeRequest: async (req) => {
      const token = await cfg.getAccessToken();
      if (!token)
        throw new Error("Your session expired. Sign in again to resume.");
      req.setHeader("Authorization", `Bearer ${token}`);
    },
    onShouldRetry: (err, attempt) => shouldRetryUpload(err, attempt),
  };
}

/** A message the contributor can act on, for an upload that gave up. */
export function describeUploadError(err: unknown): string {
  const res = (err as Partial<DetailedError> | null)?.originalResponse;
  const status = res ? res.getStatus() : 0;
  if (status === 413) {
    return "The storage server rejected the file as too large. The hosted development instance only accepts files up to 50 MB.";
  }
  if (status === 401 || status === 403) {
    return "Storage refused the upload. Sign in again, then retry.";
  }
  if (status === 409)
    return "This scan already has a file. Start a new upload.";
  if (status === 400 || status === 415) {
    return "Storage refused this file. Upload a .glb, .gltf, .ply or .zip.";
  }
  return "The connection dropped and retries ran out. Your progress is saved: press Retry to continue.";
}
