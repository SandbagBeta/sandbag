import { NextResponse, type NextRequest } from "next/server";
import { ensureProfile } from "@/lib/auth/profile";
import { safeNextPath } from "@/lib/auth/redirect";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth return point: exchange the PKCE code for a session cookie, create the
 * profile on first sign-in, then continue to a validated same-origin path.
 * New users land on /account so they can pick their handle.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const to = (path: string) =>
    NextResponse.redirect(new URL(path, request.url));

  if (!code || !isSupabaseConfigured()) return to("/sign-in?error=callback");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return to("/sign-in?error=callback");

  const profile = await ensureProfile(supabase, data.user);
  if (profile.status === "error") {
    // Signed in but no profile yet; /account retries creation. No PII logged.
    console.error(`auth callback: ${profile.error}`);
    return to("/account");
  }
  return to(profile.status === "created" ? "/account?welcome=1" : next);
}
