"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseEnv } from "./env";

/**
 * Browser-side Supabase client (anon key, RLS-enforced).
 * `createBrowserClient` memoizes a singleton per page load, so calling this
 * from multiple components is cheap.
 */
export function createClient() {
  // Literal `process.env.NEXT_PUBLIC_*` reads: Next.js inlines only those into
  // the browser bundle, so passing `process.env` itself would arrive empty.
  const { url, anonKey } = getPublicSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  return createBrowserClient(url, anonKey);
}
