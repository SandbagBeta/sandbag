/**
 * Public handles. Must stay in sync with the DB check on `profiles.handle`
 * (supabase/migrations/20261110000000_schema_v1.sql): `^[a-z0-9_]{3,32}$`.
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 32;
export const HANDLE_PATTERN = /^[a-z0-9_]{3,32}$/;
/** Used when a provider gives us nothing usable. */
export const FALLBACK_HANDLE = "climber";

/**
 * Turn any provider string into something that satisfies HANDLE_PATTERN.
 * Never returns an empty or invalid handle.
 *
 * 1. Unicode NFKD + strip combining marks ("José" -> "jose"), lowercase.
 * 2. Every char outside [a-z0-9_] becomes "_"; runs of "_" collapse to one;
 *    leading/trailing "_" are trimmed.
 * 3. Empty -> "climber"; shorter than 3 -> "<s>_climber"; longer than 32 ->
 *    truncated (and re-trimmed).
 */
export function normalizeHandle(raw: string | null | undefined): string {
  let s = (raw ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (s.length === 0) return FALLBACK_HANDLE;
  if (s.length < HANDLE_MIN) s = `${s}_${FALLBACK_HANDLE}`;
  if (s.length > HANDLE_MAX) s = s.slice(0, HANDLE_MAX).replace(/_$/, "");
  return s;
}

/** `base` with a numeric suffix, truncating `base` so the result fits. */
export function withSuffix(base: string, n: number): string {
  const suffix = `_${n}`;
  const head = base.slice(0, HANDLE_MAX - suffix.length).replace(/_$/, "");
  return `${head}${suffix}`;
}

/** The subset of a Supabase user we read. Email is only ever split locally. */
export type HandleSourceUser = {
  user_metadata?: Record<string, unknown> | null;
  email?: string | null;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/**
 * Best raw handle source, most specific first: provider username (GitHub
 * `user_name` / `preferred_username`), display name (Google `name` /
 * `full_name`), then the email local part. Only the derived, normalized
 * handle is ever stored; never the email.
 */
export function handleSource(user: HandleSourceUser): string | undefined {
  const m = user.user_metadata ?? {};
  const email = str(m.email) ?? str(user.email);
  return (
    str(m.user_name) ??
    str(m.preferred_username) ??
    str(m.name) ??
    str(m.full_name) ??
    email?.split("@")[0]
  );
}

export type HandleValidation =
  { ok: true; handle: string } | { ok: false; error: string };

/** Validate user input for the edit form. Trims and lowercases first. */
export function validateHandle(input: unknown): HandleValidation {
  const handle = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (handle.length === 0) return { ok: false, error: "Enter a handle." };
  if (handle.length < HANDLE_MIN)
    return {
      ok: false,
      error: `Handles need at least ${HANDLE_MIN} characters.`,
    };
  if (handle.length > HANDLE_MAX)
    return {
      ok: false,
      error: `Handles can have at most ${HANDLE_MAX} characters.`,
    };
  if (!HANDLE_PATTERN.test(handle))
    return {
      ok: false,
      error: "Use only lowercase letters a-z, digits 0-9 and underscores.",
    };
  return { ok: true, handle };
}
