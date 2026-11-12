import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertValidKey,
  assertValidPrefix,
  BUCKET_VISIBILITY,
  MAX_SIGNED_URL_SECONDS,
  StorageError,
  type ListedObject,
  type LogicalBucket,
  type ObjectInfo,
  type ObjectRef,
  type StorageAdapter,
} from "./types";

/**
 * Supabase Storage driver (issue #50 Part 1). Logical bucket names equal the
 * provider's. The caller picks the client and so the authority: the service
 * role for server jobs, or a user's RLS client where the user's own access is
 * what authorizes the call (e.g. reading a published mesh).
 */

const isMissing = (error: { message?: string; statusCode?: string | number }) =>
  /not found|does not exist|404/i.test(
    `${error.message ?? ""} ${error.statusCode ?? ""}`,
  );

function fail(action: string, error: { message?: string }): never {
  const detail = error.message;
  if (isMissing(error)) {
    throw new StorageError("not_found", "Object not found.", detail);
  }
  // The provider's message may name buckets or paths: keep it out of `message`.
  throw new StorageError("failed", `Storage ${action} failed.`, detail);
}

/**
 * Stable public URL of an object in a public bucket. Pure: no client, no key
 * validation, so render paths can build it from the project URL alone. Use
 * `adapter.publicUrl` where a key isn't already trusted.
 */
export function supabasePublicUrl(
  baseUrl: string,
  bucket: LogicalBucket,
  key: string,
): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${path}`;
}

export function createSupabaseStorage(
  client: SupabaseClient,
  /** Project URL, for stable public URLs. */
  baseUrl: string | (() => string),
): StorageAdapter {
  const files = (bucket: LogicalBucket) => client.storage.from(bucket);

  return {
    async put({ bucket, key }, bytes, options) {
      assertValidKey(key);
      const { error } = await files(bucket).upload(key, bytes, {
        contentType: options.contentType,
        cacheControl: options.cacheControl,
        upsert: options.upsert ?? false,
      });
      if (error) fail("put", error);
    },

    async head({ bucket, key }): Promise<ObjectInfo | null> {
      assertValidKey(key);
      const { data, error } = await files(bucket).info(key);
      if (error) {
        if (isMissing(error)) return null;
        fail("head", error);
      }
      return {
        size: data.size ?? 0,
        contentType: data.contentType ?? null,
        etag: data.etag ?? null,
      };
    },

    async download({ bucket, key }) {
      assertValidKey(key);
      const { data, error } = await files(bucket).download(key);
      if (error || !data) fail("download", error ?? {});
      return new Uint8Array(await data.arrayBuffer());
    },

    async copy(from, to) {
      assertValidKey(from.key);
      assertValidKey(to.key);
      const { error } = await files(from.bucket).copy(from.key, to.key, {
        destinationBucket: to.bucket,
      });
      if (error) fail("copy", error);
    },

    async delete(bucket, keys) {
      keys.forEach(assertValidKey);
      if (keys.length === 0) return;
      const { error } = await files(bucket).remove([...keys]);
      if (error) fail("delete", error);
    },

    // Supabase's CDN invalidates within about a minute on its own (ADR 002).
    async purge() {},

    publicUrl({ bucket, key }: ObjectRef) {
      if (BUCKET_VISIBILITY[bucket] !== "public") {
        throw new StorageError("invalid_request", "That bucket is private.");
      }
      assertValidKey(key);
      return supabasePublicUrl(
        typeof baseUrl === "function" ? baseUrl() : baseUrl,
        bucket,
        key,
      );
    },

    async signedUrl({ bucket, key }, expiresInSeconds) {
      if (BUCKET_VISIBILITY[bucket] !== "private") {
        throw new StorageError("invalid_request", "That bucket is public.");
      }
      assertValidKey(key);
      const ttl = Math.min(
        Math.max(1, Math.floor(expiresInSeconds)),
        MAX_SIGNED_URL_SECONDS,
      );
      const { data, error } = await files(bucket).createSignedUrl(key, ttl);
      if (error || !data) fail("sign", error ?? {});
      return data.signedUrl;
    },

    async list(bucket, prefix): Promise<ListedObject[]> {
      assertValidPrefix(prefix);
      const { data, error } = await files(bucket).list(
        prefix.replace(/\/+$/, ""),
      );
      if (error) fail("list", error);
      return (data ?? []).map((o) => ({
        name: o.name,
        size:
          Number((o.metadata as { size?: number } | null)?.size ?? NaN) || null,
      }));
    },
  };
}
