import { isSupabaseConfigured } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

/**
 * Liveness + config check. Reports only whether the public Supabase env vars
 * are present and well-formed; it makes no database call (schema lands in #3)
 * and never echoes env values.
 */
export function GET() {
  return Response.json({
    ok: true,
    supabase: isSupabaseConfigured() ? "configured" : "unconfigured",
  });
}
