import { createClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";
import { anonKey, serviceKey, supabaseUrl } from "./env";

/**
 * Signs a throwaway user in without OAuth, with no app-side test hook:
 * create the user with the admin API, mint a magic-link token, exchange it
 * for a session, and write the same cookie @supabase/ssr writes. Needs the
 * service-role key, so it only runs where the tester owns the database.
 */
export async function signInAs(
  context: BrowserContext,
  baseURL: string,
  email: string,
) {
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  await admin.auth.admin.createUser({ email, email_confirm: true });
  const { data: link, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !link.properties?.hashed_token)
    throw new Error(`generateLink failed: ${error?.message}`);

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
  });
  const { data, error: verifyError } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (verifyError || !data.session)
    throw new Error(`verifyOtp failed: ${verifyError?.message}`);

  // @supabase/ssr cookie: sb-<project ref>-auth-token, "base64-" + base64url(JSON).
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const value =
    "base64-" + Buffer.from(JSON.stringify(data.session)).toString("base64url");
  await context.addCookies([
    { name: `sb-${ref}-auth-token`, value, url: baseURL },
  ]);
  return { userId: data.user!.id, admin };
}
