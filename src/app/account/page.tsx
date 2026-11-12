import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { signInPath } from "@/lib/auth/gating";
import { ensureProfile } from "@/lib/auth/profile";
import { countUnread } from "@/lib/review/notifications";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { HandleForm } from "./HandleForm";

export const metadata: Metadata = { title: "Account — SandBag" };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Awaited first so the page is always rendered per request, never
  // prerendered at build time (where Supabase env may be absent).
  const welcome = (await searchParams).welcome === "1";

  // The proxy redirects signed-out users too; this is the real check.
  if (!isSupabaseConfigured()) redirect(signInPath("/account"));
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(signInPath("/account"));

  // Normally created in /auth/callback; retried here if that failed.
  const profile = await ensureProfile(supabase, data.user);
  const unread = await countUnread(supabase);

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-8 px-6 py-20">
      <h1 className="text-3xl font-bold tracking-tight">Your account</h1>
      {profile.status === "error" ? (
        <p role="alert" className="text-red-700 dark:text-red-400">
          We could not set up your profile. Reload the page to try again.
        </p>
      ) : (
        <section className="flex flex-col gap-4">
          {welcome && (
            <p className="text-stone-600 dark:text-stone-400">
              Welcome! We picked <strong>@{profile.handle}</strong> for you.
              Change it below if you like.
            </p>
          )}
          <HandleForm handle={profile.handle} />
        </section>
      )}
      <Link href="/account/notifications" className="underline">
        Notifications{unread > 0 ? ` (${unread} new)` : ""}
      </Link>
      <form action={signOut}>
        <button
          type="submit"
          className="text-sm underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
