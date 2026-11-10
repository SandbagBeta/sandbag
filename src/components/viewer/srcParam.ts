export const DEFAULT_VIEWER_SRC = "/fixtures/demo-boulder.glb";

/**
 * Validate a user-supplied scan URL (e.g. `?src=`).
 * Allows http(s) absolute URLs and root-relative paths; rejects everything
 * else (`javascript:`, `data:`, protocol-relative `//host`, relative paths).
 */
export function parseViewerSrc(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("/")) {
    return value.startsWith("//") ? null : value;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
