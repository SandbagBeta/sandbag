/**
 * Parses DEV_ALLOWED_ORIGINS for next.config.ts `allowedDevOrigins`.
 *
 * Next.js 16 blocks cross-origin requests to dev-only resources (`/_next/*`,
 * HMR) unless the requesting host is allowlisted. Without this, opening
 * `pnpm dev -H 0.0.0.0` from a phone on the LAN loads the HTML but none of the
 * JavaScript, so pages like /dev/viewer stay blank.
 *
 * Input is a comma-separated list of hosts, e.g. "192.168.1.20,my-pc.local".
 * Schemes, ports and paths are stripped because Next matches on hostname.
 * Only affects `next dev`; production builds ignore allowedDevOrigins.
 */
export function parseDevOrigins(value: string | undefined): string[] {
  if (!value) return [];
  const hosts = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(toHost)
    .filter((host): host is string => host !== null);
  return [...new Set(hosts)];
}

function toHost(entry: string): string | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(entry)
    ? entry
    : `http://${entry}`;
  try {
    // Keep the wildcard Next supports ("*.example.local"): URL rejects "*".
    const host = new URL(withScheme.replace("*.", "wildcard-placeholder."))
      .hostname;
    return host.replace("wildcard-placeholder.", "*.") || null;
  } catch {
    return null;
  }
}
