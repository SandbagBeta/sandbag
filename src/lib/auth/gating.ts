/**
 * Routes that require a signed-in user. Each entry gates the path itself and
 * everything below it ("/account" gates "/account/settings", not "/accounts").
 * Extend this list when adding gated pages (#19 "/review").
 *
 * The proxy redirect is a UX convenience, not the security boundary: gated
 * pages must still check the user server-side, and RLS guards the data.
 */
export const GATED_PATH_PREFIXES: readonly string[] = ["/account", "/upload"];

export const SIGN_IN_PATH = "/sign-in";

export function isGatedPath(
  pathname: string,
  prefixes: readonly string[] = GATED_PATH_PREFIXES,
): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Sign-in URL that returns the user to where they were headed. */
export function signInPath(pathname: string, search = ""): string {
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(pathname + search)}`;
}

/**
 * Where to send a request, or null to let it through. Pure so it can be
 * tested without a Next request.
 */
export function gateRedirect(
  pathname: string,
  search: string,
  signedIn: boolean,
  prefixes: readonly string[] = GATED_PATH_PREFIXES,
): string | null {
  if (signedIn || !isGatedPath(pathname, prefixes)) return null;
  return signInPath(pathname, search);
}
