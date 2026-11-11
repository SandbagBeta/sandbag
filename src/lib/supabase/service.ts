import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv, getServiceRoleKey } from "./env";

let client: SupabaseClient | null = null;

/**
 * SERVER ONLY. Service-role client (bypasses RLS). Callers must authorize the
 * request themselves first; the review flow does so in `src/lib/review`.
 */
export function createServiceClient(): SupabaseClient {
  client ??= createClient(getPublicSupabaseEnv().url, getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
