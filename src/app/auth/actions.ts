"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

const PROVIDERS = ["github", "google"] as const;
type Provider = (typeof PROVIDERS)[number];

function isProvider(v: unknown): v is Provider {
  return PROVIDERS.includes(v as Provider);
}

async function siteOrigin(): Promise<string> {
  const h = await headers();
  // Server actions are POSTs; Next has already checked Origin against Host.
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/** Start the OAuth (PKCE) flow; the provider returns to /auth/callback. */
export async function signInWithProvider(formData: FormData) {
  const provider = formData.get("provider");
  const next = safeNextPath(formData.get("next"));
  if (!isProvider(provider)) redirect("/sign-in?error=provider");

  const supabase = await createClient();
  const redirectTo = `${await siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  });
  if (error || !data.url) redirect("/sign-in?error=oauth");
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
