/**
 * Supabase environment configuration.
 *
 * Only `NEXT_PUBLIC_*` vars may be read from code that ships to the browser.
 * The service-role key bypasses RLS and is read exclusively by
 * `getServiceRoleKey()`, which must only be called from server-side code
 * (seed scripts, server actions, Edge Functions). Never import it into a
 * client component.
 */

export type PublicSupabaseEnv = {
  url: string;
  anonKey: string;
};

type EnvSource = Record<string, string | undefined>;

const PUBLIC_URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const PUBLIC_ANON_VAR = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
const SERVICE_ROLE_VAR = "SUPABASE_SERVICE_ROLE_KEY";

const HINT =
  "Copy .env.example to .env.local and fill in the values printed by `supabase start` (or `supabase status`).";

export class SupabaseEnvError extends Error {
  constructor(
    public readonly variable: string,
    reason: string,
  ) {
    super(`${variable} ${reason}. ${HINT}`);
    this.name = "SupabaseEnvError";
  }
}

function requireVar(source: EnvSource, name: string): string {
  const value = source[name]?.trim();
  if (!value) throw new SupabaseEnvError(name, "is not set");
  return value;
}

function validateUrl(name: string, raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SupabaseEnvError(name, `is not a valid URL (got "${raw}")`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SupabaseEnvError(
      name,
      `must use http:// or https:// (got "${parsed.protocol}")`,
    );
  }
  // Supabase clients join paths onto the base URL; a trailing slash yields "//".
  return raw.replace(/\/+$/, "");
}

function validateKey(name: string, raw: string): string {
  // Local anon/service keys are JWTs (three dot-separated base64url segments);
  // hosted projects may also issue `sb_publishable_…` / `sb_secret_…` keys.
  const looksLikeJwt = /^[\w-]+\.[\w-]+\.[\w-]+$/.test(raw);
  const looksLikeApiKey = /^sb_(publishable|secret)_[\w-]+$/.test(raw);
  if (!looksLikeJwt && !looksLikeApiKey) {
    throw new SupabaseEnvError(
      name,
      "does not look like a Supabase API key (expected a JWT or an sb_… key)",
    );
  }
  return raw;
}

/**
 * Read and validate the public (browser-safe) Supabase env vars.
 * `source` defaults to `process.env`; pass an object in tests.
 */
export function getPublicSupabaseEnv(
  source: EnvSource = process.env,
): PublicSupabaseEnv {
  const url = validateUrl(PUBLIC_URL_VAR, requireVar(source, PUBLIC_URL_VAR));
  const anonKey = validateKey(
    PUBLIC_ANON_VAR,
    requireVar(source, PUBLIC_ANON_VAR),
  );
  return { url, anonKey };
}

/** True when both public vars are present and well-formed. Never throws. */
export function isSupabaseConfigured(source: EnvSource = process.env): boolean {
  try {
    getPublicSupabaseEnv(source);
    return true;
  } catch {
    return false;
  }
}

/**
 * SERVER ONLY. Returns the service-role key, which bypasses RLS.
 * Throws if called in a browser bundle so a leak fails loudly, not silently.
 */
export function getServiceRoleKey(source: EnvSource = process.env): string {
  if (typeof window !== "undefined") {
    throw new SupabaseEnvError(
      SERVICE_ROLE_VAR,
      "must never be read in browser code",
    );
  }
  return validateKey(SERVICE_ROLE_VAR, requireVar(source, SERVICE_ROLE_VAR));
}
