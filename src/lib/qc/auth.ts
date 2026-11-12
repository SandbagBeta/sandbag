import { timingSafeEqual } from "node:crypto";

/**
 * Shared-secret check for the QC route (ADR 003 O1). The pg_cron sweep sends
 * `Authorization: Bearer <secret>`; the same value lives in Vault as
 * `qc_run_secret` (supabase/README.md) and in the app as `QC_RUN_SECRET`.
 * Fails closed: with no secret, or one under 32 characters, nobody is
 * authorized.
 */
export function isQcRequestAuthorized(
  header: string | null,
  secret: string | undefined = process.env.QC_RUN_SECRET,
): boolean {
  if (!secret || secret.length < 32 || !header) return false;
  const m = /^Bearer (.+)$/.exec(header);
  if (!m?.[1]) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(secret);
  // timingSafeEqual needs equal lengths; the length (>= 32) isn't secret.
  return a.length === b.length && timingSafeEqual(a, b);
}
