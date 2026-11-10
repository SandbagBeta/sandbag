"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseEnv } from "./env";

/**
 * Browser-side Supabase client (anon key, RLS-enforced).
 * `createBrowserClient` memoizes a singleton per page load, so calling this
 * from multiple components is cheap.
 */
export function createClient() {
  const { url, anonKey } = getPublicSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
