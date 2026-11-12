import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { flattenDocument, readGltfDocument } from "../qc/gltf";
import { storageFor } from "../storage";
import { meshSurfaceFromParsed } from "./surface";
import type { MeshSurface } from "./validate";

/**
 * SERVER ONLY. Loads the canonical mesh a climb submission is validated
 * against (issue #22, gap C). Decoding a published GLB (up to ~50 MB, Draco)
 * is the expensive part of a save, so decoded surfaces are cached per
 * `content_hash`. The key is the hash of immutable bytes, so an entry can never
 * go stale: a replaced mesh has a new hash and simply misses.
 *
 * The cache is per server instance and in memory only (cold starts decode once
 * more). It holds at most `maxEntries` surfaces and de-duplicates concurrent
 * loads of the same mesh. A surface of the largest allowed scan (5M triangles)
 * is on the order of 100 MB as float64, which is why the default is two.
 */

export interface CanonicalMeshRef {
  /** sha256 (hex) of the canonical GLB bytes: `scans.content_hash`. */
  content_hash: string;
  /** Storage key in the `published` bucket: `scans.glb_path`. */
  glb_path: string;
}

export class MeshUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeshUnavailableError";
  }
}

export type MeshDownloader = (glbPath: string) => Promise<Uint8Array>;

export function createSurfaceLoader(opts: { maxEntries?: number } = {}) {
  const max = Math.max(1, opts.maxEntries ?? 2);
  // Map keeps insertion order: the first key is the least recently used.
  const cache = new Map<string, Promise<MeshSurface>>();

  async function decode(
    ref: CanonicalMeshRef,
    download: MeshDownloader,
  ): Promise<MeshSurface> {
    const bytes = await download(ref.glb_path);
    // Never validate against bytes that aren't the mesh the hash names.
    if (createHash("sha256").update(bytes).digest("hex") !== ref.content_hash) {
      throw new MeshUnavailableError(
        "The stored mesh does not match the scan's content hash.",
      );
    }
    const doc = await readGltfDocument({ kind: "glb", bytes });
    return meshSurfaceFromParsed(flattenDocument(doc, "glb"));
  }

  return function load(
    ref: CanonicalMeshRef,
    download: MeshDownloader,
  ): Promise<MeshSurface> {
    const hit = cache.get(ref.content_hash);
    if (hit) {
      cache.delete(ref.content_hash);
      cache.set(ref.content_hash, hit); // mark most recently used
      return hit;
    }
    const pending = decode(ref, download);
    cache.set(ref.content_hash, pending);
    // A failure is not cached: the next request retries.
    pending.catch(() => {
      if (cache.get(ref.content_hash) === pending) {
        cache.delete(ref.content_hash);
      }
    });
    while (cache.size > max) {
      cache.delete(cache.keys().next().value as string);
    }
    return pending;
  };
}

const shared = createSurfaceLoader();

/**
 * Loads a published scan's surface using the given (service-role) client.
 * Downloads only on a cache miss.
 */
export function loadCanonicalSurface(
  db: SupabaseClient,
  ref: CanonicalMeshRef,
): Promise<MeshSurface> {
  return shared(ref, async (path) => {
    try {
      return await storageFor(db).download({ bucket: "published", key: path });
    } catch {
      throw new MeshUnavailableError("The mesh could not be downloaded.");
    }
  });
}
