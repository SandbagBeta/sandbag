import type { StorageAdapter } from "../storage/types";
import type { UploadItem } from "./dashboard";

const SIGNED_SECONDS = 600;

/**
 * Thumbnail URL per upload id. Published ones are public; the rest live in the
 * private `uploads` bucket and get a short-lived signed URL. A missing object
 * or a storage error is a null (the card shows its placeholder), never a throw.
 * `privateStorage` must only ever be asked about the signed-in user's own
 * scans: the items come from their RLS-scoped query.
 */
export async function resolveThumbs(
  items: readonly UploadItem[],
  publicStorage: Pick<StorageAdapter, "publicUrl">,
  privateStorage: Pick<StorageAdapter, "signedUrl"> | null,
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    items.map(async (i): Promise<[string, string | null]> => {
      if (!i.thumb) return [i.id, null];
      try {
        if (i.thumb.bucket === "published") {
          return [
            i.id,
            publicStorage.publicUrl({ bucket: "published", key: i.thumb.key }),
          ];
        }
        if (!privateStorage) return [i.id, null];
        return [
          i.id,
          await privateStorage.signedUrl(
            { bucket: "uploads", key: i.thumb.key },
            SIGNED_SECONDS,
          ),
        ];
      } catch {
        return [i.id, null];
      }
    }),
  );
  return Object.fromEntries(entries);
}
