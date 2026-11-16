import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicProfileView } from "@/components/account/PublicProfileView";
import { loadPublicProfile, parseHandle } from "@/lib/profile/load";
import { getPublicSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

type Params = Promise<{ handle: string }>;

// Title only: no description or Open Graph data. The handle is validated, so
// nothing unchecked reaches the head.
export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const handle = parseHandle((await params).handle);
  return { title: handle ? `@${handle} — SandBag` : "Profile — SandBag" };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Params;
}) {
  const handle = parseHandle((await params).handle);
  if (!handle || !isSupabaseConfigured()) notFound();
  const profile = await loadPublicProfile(await createClient(), handle);
  if (!profile) notFound();
  return (
    <PublicProfileView
      profile={profile}
      supabaseUrl={getPublicSupabaseEnv().url}
    />
  );
}
