import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicSupabaseEnv } from "./env";

/**
 * Server-side Supabase client (anon key + the user's auth cookies, so RLS
 * applies as that user). Use in Server Components, Route Handlers and Server
 * Actions. Create a new instance per request; do not cache it in a module.
 */
export async function createClient() {
  const { url, anonKey } = getPublicSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore when middleware refreshes sessions.
        }
      },
    },
  });
}
