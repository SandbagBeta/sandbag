/**
 * Whether dev-only harness routes (e.g. /dev/viewer) may render.
 *
 * - `next dev` / tests: enabled.
 * - Vercel preview deployments: enabled, so PR previews can be tested on
 *   real phones. Previews sit behind Vercel Deployment Protection by default.
 * - Vercel production, or a self-hosted `next start` build: disabled (404).
 *
 * Vercel builds always run with NODE_ENV=production, so NODE_ENV alone
 * cannot tell a preview from production; VERCEL_ENV can.
 */
export function isDevHarnessEnabled(
  env: Partial<Record<"NODE_ENV" | "VERCEL_ENV", string>> = process.env,
): boolean {
  if (env.NODE_ENV !== "production") return true;
  return env.VERCEL_ENV === "preview";
}
