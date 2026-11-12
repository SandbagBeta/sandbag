import {
  StorageError,
  type LogicalBucket,
  type StorageAdapter,
} from "../storage/types";

/**
 * TEST ONLY. An in-memory StorageAdapter for lifecycle tests: objects per
 * logical bucket, a call log, and `failNext` to simulate a provider error.
 */
export interface FakeStorage {
  adapter: StorageAdapter;
  /** `bucket/key` -> bytes. */
  objects: Map<string, Uint8Array>;
  /** Operations in order, e.g. "put published/abc/def.glb". */
  log: string[];
  /** Make the next call of `op` throw a StorageError. */
  failNext(op: string): void;
  has(bucket: LogicalBucket, key: string): boolean;
}

export function createFakeStorage(
  seed: Record<string, Uint8Array> = {},
): FakeStorage {
  const objects = new Map(Object.entries(seed));
  const log: string[] = [];
  const failures = new Set<string>();
  const at = (bucket: string, key: string) => `${bucket}/${key}`;
  const enter = (op: string, bucket: string, key = "") => {
    log.push(`${op} ${at(bucket, key)}`.trim());
    if (failures.delete(op)) throw new StorageError("failed", `${op} failed`);
  };

  const adapter: StorageAdapter = {
    async put({ bucket, key }, bytes) {
      enter("put", bucket, key);
      objects.set(at(bucket, key), bytes);
    },
    async head({ bucket, key }) {
      enter("head", bucket, key);
      const o = objects.get(at(bucket, key));
      return o ? { size: o.length, contentType: null, etag: null } : null;
    },
    async download({ bucket, key }) {
      enter("download", bucket, key);
      const o = objects.get(at(bucket, key));
      if (!o) throw new StorageError("not_found", "Object not found.");
      return o;
    },
    async copy(from, to) {
      enter("copy", from.bucket, from.key);
      const o = objects.get(at(from.bucket, from.key));
      if (!o) throw new StorageError("not_found", "Object not found.");
      objects.set(at(to.bucket, to.key), o);
    },
    async delete(bucket, keys) {
      enter("delete", bucket, keys.join(","));
      for (const k of keys) objects.delete(at(bucket, k));
    },
    async purge() {},
    publicUrl: ({ bucket, key }) => `https://fake.test/${bucket}/${key}`,
    async signedUrl({ bucket, key }) {
      return `https://fake.test/signed/${bucket}/${key}`;
    },
    async list() {
      return [];
    },
  };

  return {
    adapter,
    objects,
    log,
    failNext: (op) => void failures.add(op),
    has: (bucket, key) => objects.has(at(bucket, key)),
  };
}
