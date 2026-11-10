import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { gateRedirect } from "../auth/gating";
import { getPublicSupabaseEnv, isSupabaseConfigured } from "./env";

/**
 * Refresh the Supabase session cookie on every request (the documented
 * @supabase/ssr proxy pattern) and redirect signed-out users away from gated
 * routes. Called from src/proxy.ts.
 */
export async function updateSession(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!isSupabaseConfigured()) {
    // No auth backend: nobody can be signed in.
    const to = gateRedirect(pathname, search, false);
    return to
      ? NextResponse.redirect(new URL(to, request.url))
      : NextResponse.next();
  }

  const { url, anonKey } = getPublicSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet)
          request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {}))
          response.headers.set(key, value);
      },
    },
  });

  // Do not run code between createServerClient and getClaims: getClaims
  // validates the JWT and refreshes an expired session via setAll above.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const to = gateRedirect(pathname, search, signedIn);
  if (!to) return response;

  // Carry any refreshed cookies over to the redirect.
  const redirect = NextResponse.redirect(new URL(to, request.url));
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
