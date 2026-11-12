import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseStorage, supabasePublicUrl } from "./supabase";
import { MAX_SIGNED_URL_SECONDS, StorageError } from "./types";

type Obj = { bytes: Uint8Array; contentType: string };

/** In-memory stand-in for the supabase-js storage API the driver uses. */
function fakeClient(opts: { failWith?: { message: string } } = {}) {
  const buckets = new Map<string, Map<string, Obj>>();
  const calls = vi.fn();
  const bucket = (name: string) => {
    if (!buckets.has(name)) buckets.set(name, new Map());
    return buckets.get(name)!;
  };
  const missing = { message: "Object not found", statusCode: "404" };
  const storage = {
    from(name: string) {
      const b = bucket(name);
      return {
        async upload(
          key: string,
          body: Uint8Array,
          o: { contentType: string; upsert: boolean; cacheControl?: string },
        ) {
          calls("upload", name, key, o.cacheControl);
          if (opts.failWith) return { data: null, error: opts.failWith };
          if (b.has(key) && !o.upsert) {
            return {
              data: null,
              error: { message: "The resource already exists" },
            };
          }
          b.set(key, { bytes: body, contentType: o.contentType });
          return { data: { path: key }, error: null };
        },
        async info(key: string) {
          calls("info", name, key);
          const o = b.get(key);
          if (!o) return { data: null, error: missing };
          return {
            data: {
              size: o.bytes.length,
              contentType: o.contentType,
              etag: "e1",
            },
            error: null,
          };
        },
        async download(key: string) {
          calls("download", name, key);
          const o = b.get(key);
          if (!o) return { data: null, error: missing };
          return { data: new Blob([o.bytes as BlobPart]), error: null };
        },
        async copy(
          from: string,
          to: string,
          o?: { destinationBucket?: string },
        ) {
          calls("copy", name, from, o?.destinationBucket, to);
          const src = b.get(from);
          if (!src) return { data: null, error: missing };
          bucket(o?.destinationBucket ?? name).set(to, src);
          return { data: { path: to }, error: null };
        },
        async remove(keys: string[]) {
          calls("remove", name, keys);
          for (const k of keys) b.delete(k);
          return { data: [], error: null };
        },
        async createSignedUrl(key: string, ttl: number) {
          calls("sign", name, key, ttl);
          return {
            data: { signedUrl: `https://x.test/sign/${name}/${key}?t=${ttl}` },
            error: null,
          };
        },
        async list(prefix: string) {
          calls("list", name, prefix);
          const p = prefix ? `${prefix}/` : "";
          const names = new Map<string, number | null>();
          for (const [k, o] of b) {
            if (!k.startsWith(p)) continue;
            const [first, ...rest] = k.slice(p.length).split("/");
            names.set(first!, rest.length ? null : o.bytes.length);
          }
          return {
            data: [...names].map(([n, size]) => ({
              name: n,
              metadata: size === null ? null : { size },
            })),
            error: null,
          };
        },
      };
    },
  };
  return { client: { storage } as unknown as SupabaseClient, calls, buckets };
}

const BASE = "https://proj.supabase.co/";
const bytes = (...n: number[]) => new Uint8Array(n);
const KEY = "scans/abc/def.glb";

describe("Supabase storage driver (#50)", () => {
  it("passes only the max-age seconds to supabase-js, which prefixes max-age= itself", async () => {
    const { client, calls } = fakeClient();
    const s = createSupabaseStorage(client, BASE);
    const ct = { contentType: "x/y" };
    await s.put({ bucket: "published", key: "a/1.glb" }, bytes(1), {
      ...ct,
      cacheControl: "public, max-age=31536000, immutable",
    });
    await s.put({ bucket: "published", key: "a/2.glb" }, bytes(1), ct);
    await s.put({ bucket: "published", key: "a/3.glb" }, bytes(1), {
      ...ct,
      cacheControl: "no-store",
    });
    expect(calls).toHaveBeenCalledWith(
      "upload",
      "published",
      "a/1.glb",
      "31536000",
    );
    expect(calls).toHaveBeenCalledWith(
      "upload",
      "published",
      "a/2.glb",
      undefined,
    );
    expect(calls).toHaveBeenCalledWith(
      "upload",
      "published",
      "a/3.glb",
      undefined,
    );
  });

  it("round-trips put, head and download", async () => {
    const { client } = fakeClient();
    const s = createSupabaseStorage(client, BASE);
    await s.put({ bucket: "published", key: KEY }, bytes(1, 2, 3), {
      contentType: "model/gltf-binary",
    });
    expect(await s.head({ bucket: "published", key: KEY })).toEqual({
      size: 3,
      contentType: "model/gltf-binary",
      etag: "e1",
    });
    expect(await s.download({ bucket: "published", key: KEY })).toEqual(
      bytes(1, 2, 3),
    );
  });

  it("head of a missing object is null; download throws not_found", async () => {
    const s = createSupabaseStorage(fakeClient().client, BASE);
    expect(await s.head({ bucket: "published", key: KEY })).toBeNull();
    await expect(
      s.download({ bucket: "published", key: KEY }),
    ).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses to overwrite unless upsert is set", async () => {
    const s = createSupabaseStorage(fakeClient().client, BASE);
    const ref = { bucket: "published" as const, key: KEY };
    const o = { contentType: "x/y" };
    await s.put(ref, bytes(1), o);
    await expect(s.put(ref, bytes(2), o)).rejects.toMatchObject({
      code: "failed",
    });
    await s.put(ref, bytes(2), { ...o, upsert: true });
    expect(await s.download(ref)).toEqual(bytes(2));
  });

  it("copies across logical buckets", async () => {
    const { client, buckets } = fakeClient();
    const s = createSupabaseStorage(client, BASE);
    await s.put({ bucket: "uploads", key: "u/s/raw/source.glb" }, bytes(9), {
      contentType: "x/y",
    });
    await s.copy(
      { bucket: "uploads", key: "u/s/raw/source.glb" },
      { bucket: "published", key: KEY },
    );
    expect(buckets.get("published")!.get(KEY)!.bytes).toEqual(bytes(9));
    await expect(
      s.copy(
        { bucket: "uploads", key: "nope" },
        { bucket: "published", key: "x" },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("deletes objects, ignores missing keys, and skips the call for none", async () => {
    const { client, calls } = fakeClient();
    const s = createSupabaseStorage(client, BASE);
    await s.delete("published", [KEY, "never/existed.glb"]);
    expect(calls).toHaveBeenCalledWith("remove", "published", [
      KEY,
      "never/existed.glb",
    ]);
    calls.mockClear();
    await s.delete("published", []);
    expect(calls).not.toHaveBeenCalled();
  });

  it("purge is a no-op on Supabase", async () => {
    const { client, calls } = fakeClient();
    await createSupabaseStorage(client, BASE).purge({
      bucket: "published",
      key: KEY,
    });
    expect(calls).not.toHaveBeenCalled();
  });

  describe("URLs follow bucket visibility", () => {
    const s = createSupabaseStorage(fakeClient().client, BASE);

    it("public bucket: stable URL, encoded, no trailing-slash doubling", () => {
      expect(s.publicUrl({ bucket: "published", key: KEY })).toBe(
        "https://proj.supabase.co/storage/v1/object/public/published/scans/abc/def.glb",
      );
      expect(supabasePublicUrl(BASE, "published", "a b/c#d.glb")).toBe(
        "https://proj.supabase.co/storage/v1/object/public/published/a%20b/c%23d.glb",
      );
    });

    it("never gives a public URL for a private bucket", () => {
      for (const bucket of ["uploads", "originals"] as const) {
        expect(() => s.publicUrl({ bucket, key: KEY })).toThrow(StorageError);
      }
    });

    it("signed URLs only for private buckets, with the lifetime capped", async () => {
      const { client, calls } = fakeClient();
      const sg = createSupabaseStorage(client, BASE);
      await expect(
        sg.signedUrl({ bucket: "published", key: KEY }, 60),
      ).rejects.toMatchObject({
        code: "invalid_request",
      });
      await sg.signedUrl({ bucket: "uploads", key: KEY }, 999_999);
      expect(calls).toHaveBeenCalledWith(
        "sign",
        "uploads",
        KEY,
        MAX_SIGNED_URL_SECONDS,
      );
      await sg.signedUrl({ bucket: "uploads", key: KEY }, 0);
      expect(calls).toHaveBeenCalledWith("sign", "uploads", KEY, 1);
    });

    it("reads the project URL lazily, only when a public URL is built", () => {
      const base = vi.fn(() => BASE);
      const sl = createSupabaseStorage(fakeClient().client, base);
      expect(base).not.toHaveBeenCalled();
      sl.publicUrl({ bucket: "published", key: KEY });
      expect(base).toHaveBeenCalledTimes(1);
    });
  });

  it("lists one level under a prefix with sizes", async () => {
    const { client } = fakeClient();
    const s = createSupabaseStorage(client, BASE);
    await s.put({ bucket: "uploads", key: "u/s/raw/source.glb" }, bytes(1, 2), {
      contentType: "x/y",
    });
    expect(await s.list("uploads", "u/s/raw")).toEqual([
      { name: "source.glb", size: 2 },
    ]);
    expect(await s.list("uploads", "u/")).toEqual([{ name: "s", size: null }]);
  });

  describe("keys", () => {
    it.each([
      "",
      "/abs/path.glb",
      "a//b.glb",
      "../etc/passwd",
      "a/../b.glb",
      "a/./b.glb",
      "a\\b.glb",
      "a b.glb",
      "tab\t.glb",
      "café.glb",
      "x".repeat(513),
    ])("rejects %j before any provider call", async (key) => {
      const { client, calls } = fakeClient();
      const s = createSupabaseStorage(client, BASE);
      await expect(
        s.download({ bucket: "published", key }),
      ).rejects.toMatchObject({
        code: "invalid_request",
      });
      await expect(
        s.put({ bucket: "published", key }, bytes(1), { contentType: "x/y" }),
      ).rejects.toBeInstanceOf(StorageError);
      expect(() => s.publicUrl({ bucket: "published", key })).toThrow(
        StorageError,
      );
      expect(calls).not.toHaveBeenCalled();
    });

    it("accepts ids, hashes and fixed file names", async () => {
      const s = createSupabaseStorage(fakeClient().client, BASE);
      const hash = "a".repeat(64);
      await s.put(
        {
          bucket: "published",
          key: `scans/00000000-0000-4000-8000-000000000000/${hash}.glb`,
        },
        bytes(1),
        { contentType: "x/y" },
      );
    });

    it("validates list prefixes too", async () => {
      const s = createSupabaseStorage(fakeClient().client, BASE);
      await expect(s.list("uploads", "../x")).rejects.toMatchObject({
        code: "invalid_request",
      });
      await expect(s.list("uploads", "")).resolves.toEqual([]);
    });
  });

  it("keeps the provider's message out of `message`, in `detail`", async () => {
    const s = createSupabaseStorage(
      fakeClient({ failWith: { message: "bucket secret-name denied" } }).client,
      BASE,
    );
    const err = (await s
      .put({ bucket: "published", key: KEY }, bytes(1), { contentType: "x/y" })
      .then(
        () => null,
        (e: unknown) => e,
      )) as StorageError;
    expect(err).toBeInstanceOf(StorageError);
    expect(err.message).not.toMatch(/secret-name/);
    expect(err.detail).toMatch(/secret-name/);
  });
});
