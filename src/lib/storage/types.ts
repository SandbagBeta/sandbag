/**
 * Storage adapter contract (issue #50 Part 1, ADR 002 "Self-hosting and the
 * storage adapter"). Every storage call goes through it, the way coordinates go
 * through the location formatter. Callers name only a logical bucket and a key
 * built from ids and content hashes; they never see a provider bucket name,
 * endpoint or credential. The Supabase driver is the default; an R2 driver
 * (Part 2) implements the same interface.
 */

/** Logical buckets. Provider bucket names are the driver's business. */
export type LogicalBucket = "uploads" | "published" | "originals";

/** Fixed per bucket. There is no way to get a public URL for a private one. */
export const BUCKET_VISIBILITY: Readonly<
  Record<LogicalBucket, "public" | "private">
> = {
  uploads: "private",
  published: "public",
  originals: "private",
};

export interface ObjectRef {
  bucket: LogicalBucket;
  key: string;
}

export interface ObjectInfo {
  size: number;
  contentType: string | null;
  etag: string | null;
}

export interface ListedObject {
  /** Name relative to the listed prefix (one level, like a folder listing). */
  name: string;
  size: number | null;
}

export interface PutOptions {
  contentType: string;
  /** A full Cache-Control header value. The Supabase driver can only keep its max-age. */
  cacheControl?: string;
  /** Overwrite an existing object. Default false. */
  upsert?: boolean;
}

export type StorageErrorCode =
  /** The object (or bucket) doesn't exist. */
  | "not_found"
  /** The request breaks a rule of the adapter (bad key, wrong visibility). */
  | "invalid_request"
  /** The provider failed or refused. */
  | "failed";

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
    /**
     * The provider's own message, for server logs and dev scripts only. It can
     * name buckets or paths, so never show it to a user.
     */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/** Longest signed URL the adapter will mint, whatever the caller asks for. */
export const MAX_SIGNED_URL_SECONDS = 3600;

export interface StorageAdapter {
  /** Writes a small server-generated object (GLB, thumbnail, manifest). */
  put(ref: ObjectRef, bytes: Uint8Array, options: PutOptions): Promise<void>;
  /** Size, content type and ETag, or null when the object is missing. */
  head(ref: ObjectRef): Promise<ObjectInfo | null>;
  /** The whole object. Throws `not_found` if missing. */
  download(ref: ObjectRef): Promise<Uint8Array>;
  /** Copies between logical buckets, which may cross providers. */
  copy(from: ObjectRef, to: ObjectRef): Promise<void>;
  /** Deletes objects. Missing keys are not an error. */
  delete(bucket: LogicalBucket, keys: readonly string[]): Promise<void>;
  /** Purges the object's public URL from any CDN. A no-op where automatic. */
  purge(ref: ObjectRef): Promise<void>;
  /** Stable URL of a public-bucket object. Throws for a private bucket. */
  publicUrl(ref: ObjectRef): string;
  /**
   * Short-lived URL of a private-bucket object. `expiresInSeconds` is capped at
   * {@link MAX_SIGNED_URL_SECONDS}. Throws for a public bucket (use publicUrl).
   * The caller must already have authorized the read.
   */
  signedUrl(ref: ObjectRef, expiresInSeconds: number): Promise<string>;
  /** One-level listing under a prefix, for reconcile and retention jobs. */
  list(bucket: LogicalBucket, prefix: string): Promise<ListedObject[]>;
}

/**
 * Keys are built only from ids, hashes and fixed file names, never from
 * names or coordinates. Rejecting anything else also blocks path traversal.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertValidKey(key: string): void {
  const segments = key.split("/");
  if (
    key.length === 0 ||
    key.length > 512 ||
    !segments.every(
      (s) => SEGMENT.test(s) && s !== "." && s !== ".." && !s.includes(".."),
    )
  ) {
    throw new StorageError("invalid_request", "Invalid storage key.");
  }
}

/** A prefix is a key without a trailing file: empty (the bucket root) or valid segments. */
export function assertValidPrefix(prefix: string): void {
  if (prefix !== "") assertValidKey(prefix.replace(/\/+$/, ""));
}
