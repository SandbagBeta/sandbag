import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { signInPath } from "@/lib/auth/gating";
import { loadMyPendingClimbs } from "@/lib/annotations/editClimb";
import { ensureProfile } from "@/lib/auth/profile";
import { countUnread } from "@/lib/review/notifications";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { AutoRefresh } from "@/components/account/AutoRefresh";
import {
  ClimbsSection,
  UploadsSection,
  VotesSection,
} from "@/components/account/Dashboard";
import {
  loadMyClimbs,
  loadMyUploads,
  loadMyVotes,
} from "@/lib/profile/dashboard";
import { resolveThumbs } from "@/lib/profile/thumbs";
import { isInFlight } from "@/lib/scan-report/tracker";
import { storageFor } from "@/lib/storage";
import { createServiceClient } from "@/lib/supabase/service";
import { getServiceRoleKey } from "@/lib/supabase/env";
import { HandleForm } from "./HandleForm";

export const metadata: Metadata = { title: "Account — SandBag" };

function serviceStorage() {
  try {
    getServiceRoleKey();
    return storageFor(createServiceClient());
  } catch {
    return null;
  }
}

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
  const pending = await loadMyPendingClimbs(supabase, data.user.id);
  const [uploads, climbs, votes] = await Promise.all([
    loadMyUploads(supabase, data.user.id),
    loadMyClimbs(supabase, data.user.id),
    loadMyVotes(supabase, data.user.id),
  ]);
  // Thumbnails of unpublished scans sit in the private bucket, which the user's
  // own session can't sign. Only the user's own scans (loaded above under RLS)
  // are ever asked about; without a service key they get the placeholder.
  const thumbs = await resolveThumbs(
    uploads,
    storageFor(supabase),
    serviceStorage(),
  );

  return (
    <main className="page">
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        Your account
      </h1>
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
      {profile.status !== "error" && (
        <p>
          <Link
            href={`/u/${profile.handle}`}
            className="text-moss font-semibold underline underline-offset-4 hover:no-underline"
          >
            View public profile
          </Link>
        </p>
      )}
      <AutoRefresh active={uploads.some((u) => isInFlight(u.status))} />
      <UploadsSection uploads={uploads} thumbs={thumbs} />
      <ClimbsSection climbs={climbs} />
      <VotesSection votes={votes} />
      {pending.length > 0 && (
        <section
          aria-labelledby="pending-heading"
          className="flex flex-col gap-2"
        >
          <h2 id="pending-heading" className="text-xl font-semibold">
            Your climbs waiting for review
          </h2>
          <ul className="flex flex-col gap-1">
            {pending.map((c) => (
              <li key={c.id}>
                {c.name}{" "}
                <Link href={c.href} className="underline">
                  Edit
                </Link>
              </li>
            ))}
          </ul>
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
