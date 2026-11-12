import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { signInPath } from "@/lib/auth/gating";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { TrustLevel } from "@/lib/types";

/** Signed-in user and their trust level; redirects signed-out visitors. */
export async function getReviewer(path: string) {
  await connection();
  if (!isSupabaseConfigured()) redirect(signInPath(path));
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(signInPath(path));
  const { data: profile } = await supabase
    .from("profiles")
    .select("trust_level")
    .eq("id", data.user.id)
    .maybeSingle();
  return {
    supabase,
    userId: data.user.id,
    trust: (profile?.trust_level ?? null) as TrustLevel | null,
  };
}
