import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { signInPath } from "@/lib/auth/gating";
import { loadNotifications } from "@/lib/review/notifications";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { markAllReadAction } from "./actions";

export const metadata: Metadata = {
  title: "Notifications — SandBag",
  robots: { index: false },
};

export default async function NotificationsPage() {
  await connection();
  const path = "/account/notifications";
  if (!isSupabaseConfigured()) redirect(signInPath(path));
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(signInPath(path));
  const items = await loadNotifications(supabase);
  const unread = items.filter((i) => i.unread).length;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-16">
      <div>
        <Link href="/account" className="underline">
          Your account
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Notifications
        </h1>
      </div>
      {items.length === 0 ? (
        <p className="text-stone-600 dark:text-stone-400">
          Nothing yet. When a reviewer decides on your scan or climb, you will
          see the verdict and reason here.
        </p>
      ) : (
        <>
          {unread > 0 && (
            <form action={markAllReadAction}>
              <button
                type="submit"
                className="text-sm underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Mark {unread} as read
              </button>
            </form>
          )}
          <ul className="flex flex-col gap-3">
            {items.map((n) => (
              <li
                key={n.id}
                className="rounded border border-stone-300 p-4 dark:border-stone-700"
              >
                <p className="font-semibold">
                  {n.message}
                  {n.unread && (
                    <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-950">
                      New
                    </span>
                  )}
                </p>
                {n.reason && (
                  <p className="mt-1 text-stone-700 dark:text-stone-300">
                    Reviewer note: {n.reason}
                  </p>
                )}
                <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
                  {new Date(n.created_at).toISOString().slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
