import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseEnv } from "../supabase/env";
import { createSupabaseStorage } from "./supabase";
import type { StorageAdapter } from "./types";

export * from "./types";
export { createSupabaseStorage, supabasePublicUrl } from "./supabase";

/**
 * The storage adapter for a Supabase client (issue #50). The caller picks the
 * client, and so the authority: the service role for server jobs, or a user's
 * RLS client where their own access authorizes the call. The project URL is
 * read lazily, only when a public URL is built.
 */
export function storageFor(client: SupabaseClient): StorageAdapter {
  return createSupabaseStorage(client, () => getPublicSupabaseEnv().url);
}
