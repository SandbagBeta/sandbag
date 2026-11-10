/**
 * Open-redirect guard for `?next=` parameters. Returns a same-origin relative
 * path (pathname + search + hash) or `fallback`.
 */

const BASE = "http://sandbag.invalid";
// Control chars (incl. tab/newline, which URL parsing silently strips).
const CONTROL = /[\u0000-\u001f\u007f]/;

function looksUnsafe(s: string): boolean {
  return (
    !s.startsWith("/") ||
    s.startsWith("//") ||
    s.includes("\\") ||
    CONTROL.test(s)
  );
}

export function safeNextPath(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048)
    return fallback;

  // Check the raw value and every percent-decoding of it, so "%2F%2Fevil.com"
  // or "/%5Cevil.com" cannot turn into "//evil.com" somewhere downstream.
  let s = raw;
  for (let i = 0; i < 3; i++) {
    if (looksUnsafe(s)) return fallback;
    let decoded: string;
    try {
      decoded = decodeURIComponent(s);
    } catch {
      return fallback;
    }
    if (decoded === s) break;
    s = decoded;
  }

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
