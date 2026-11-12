import { createHash } from "node:crypto";
import type { StorageAdapter } from "../storage/types";
import { UUID } from "./internal";
import { LifecycleError } from "./transitions";

/**
 * SERVER ONLY, private to src/lib/lifecycle (issue #116, ADR 002 §3). Moves a
 * scan's canonical GLB (and thumbnail) from the private `uploads` bucket to the
 * public `published` bucket when the scan is approved:
 *
 *   uploads/{uploader}/{scan}/derived/{hash}.glb  ->  published/{scan}/{hash}.glb
 *   uploads/{uploader}/{scan}/derived/thumb.webp  ->  published/{scan}/{hash}.webp
 *
 * Public keys carry no uploader id, and the content hash makes the objects
 * immutable, so they are served with a one-year `immutable` cache header.
 *
 * Only that exact derived key is ever copied: `glb_path` is a database value,
 * and it must never be able to publish some other object from `uploads`
 * (someone's raw upload). The bytes are re-hashed against `content_hash`
 * before they are made public.
 */

export class PublishObjectsError extends LifecycleError {}

const HASH = /^[0-9a-f]{64}$/;
const IMMUTABLE = "public, max-age=31536000, immutable";

export const publishedGlbKey = (scanId: string, hash: string) =>
  `${scanId.toLowerCase()}/${hash}.glb`;
export const publishedThumbKey = (scanId: string, hash: string) =>
  `${scanId.toLowerCase()}/${hash}.webp`;

export interface PublishedObjects {
  /** Key in `published`; becomes `scans.glb_path`. */
  glbKey: string;
  thumbKey: string | null;
  /** Derived copies in `uploads` to delete once the scan is published. */
  derivedKeys: string[];
}

/** Copies a scan's objects to `published`. Throws PublishObjectsError; nothing is left half-done that matters (keys are immutable). */
export async function publishScanObjects(
  storage: StorageAdapter,
  scan: { id: string; glb_path: string; content_hash: string },
): Promise<PublishedObjects> {
  const { id, glb_path: path, content_hash: hash } = scan;
  if (!UUID.test(id) || !HASH.test(hash)) {
    throw new PublishObjectsError(`Scan ${id}: bad id or content hash.`);
  }
  const glbKey = publishedGlbKey(id, hash);

  try {
    // Already in `published` (e.g. a retry or seeded data): just confirm it.
    if (path === glbKey) {
      if (!(await storage.head({ bucket: "published", key: glbKey }))) {
        throw new PublishObjectsError(
          `Scan ${id}: glb_path points at a missing published object.`,
        );
      }
      return { glbKey, thumbKey: null, derivedKeys: [] };
    }

    const [uploader, scanPart, folder, file, extra] = path.split("/");
    if (
      extra !== undefined ||
      !uploader ||
      !UUID.test(uploader) ||
      scanPart?.toLowerCase() !== id.toLowerCase() ||
      folder !== "derived" ||
      file !== `${hash}.glb`
    ) {
      throw new PublishObjectsError(
        `Scan ${id}: glb_path is not this scan's derived GLB, so it won't be published.`,
      );
    }

    const bytes = await storage.download({ bucket: "uploads", key: path });
    if (createHash("sha256").update(bytes).digest("hex") !== hash) {
      throw new PublishObjectsError(
        `Scan ${id}: the stored GLB does not match its content hash.`,
      );
    }
    await storage.put({ bucket: "published", key: glbKey }, bytes, {
      contentType: "model/gltf-binary",
      cacheControl: IMMUTABLE,
      upsert: true,
    });
    const head = await storage.head({ bucket: "published", key: glbKey });
    if (!head || head.size !== bytes.length) {
      throw new PublishObjectsError(
        `Scan ${id}: the published copy is incomplete.`,
      );
    }

    // The thumbnail is a nicety: its absence or failure never blocks a publish.
    const thumbSource = `${uploader}/${scanPart}/derived/thumb.webp`;
    let thumbKey: string | null = null;
    try {
      const thumb = await storage.download({
        bucket: "uploads",
        key: thumbSource,
      });
      const key = publishedThumbKey(id, hash);
      await storage.put({ bucket: "published", key }, thumb, {
        contentType: "image/webp",
        cacheControl: IMMUTABLE,
        upsert: true,
      });
      thumbKey = key;
    } catch {
      thumbKey = null;
    }

    return {
      glbKey,
      thumbKey,
      derivedKeys: thumbKey ? [path, thumbSource] : [path],
    };
  } catch (err) {
    if (err instanceof PublishObjectsError) throw err;
    // Storage errors may name buckets or paths: keep them out of the message.
    throw new PublishObjectsError(`Scan ${id}: copying to published failed.`);
  }
}

/** Removes the public copies again (the status change lost a race). Best effort. */
export async function unpublishScanObjects(
  storage: StorageAdapter,
  objects: PublishedObjects,
): Promise<void> {
  const keys = [
    objects.glbKey,
    ...(objects.thumbKey ? [objects.thumbKey] : []),
  ];
  try {
    await storage.delete("published", keys);
  } catch {
    // A leftover public object for an unpublished scan is what the reconcile
    // job (ADR 002 §3) exists to find; there is nothing more to do here.
  }
}

/** Deletes the derived copies in `uploads` once the scan is published. Best effort. */
export async function deleteDerivedObjects(
  storage: StorageAdapter,
  objects: PublishedObjects,
): Promise<void> {
  if (objects.derivedKeys.length === 0) return;
  try {
    await storage.delete("uploads", objects.derivedKeys);
  } catch {
    // Harmless: private, and retention deletes it later.
  }
}
