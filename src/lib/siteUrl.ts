/**
 * Absolute site origin, used as Next.js `metadataBase` so canonical links and
 * Open Graph URLs are absolute (link-preview scrapers ignore relative ones).
 *
 * Order: SITE_URL (self-hosters set this), then Vercel's production domain,
 * then the current Vercel deployment (previews), then localhost.
 */
export function siteUrl(
  // Reads SITE_URL, VERCEL_ENV, VERCEL_PROJECT_PRODUCTION_URL, VERCEL_URL, PORT.
  env: Record<string, string | undefined> = process.env,
): URL {
  const explicit = parse(env.SITE_URL);
  if (explicit) return explicit;
  if (env.VERCEL_ENV === "production") {
    const prod = parse(env.VERCEL_PROJECT_PRODUCTION_URL, "https://");
    if (prod) return prod;
  }
  return (
    parse(env.VERCEL_URL, "https://") ??
    new URL(`http://localhost:${env.PORT || 3000}`)
  );
}

function parse(value: string | undefined, scheme = ""): URL | null {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//.test(value) ? value : scheme + value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? new URL(url.origin)
      : null;
  } catch {
    return null;
  }
}
