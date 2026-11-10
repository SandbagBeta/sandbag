import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signInWithProvider } from "@/app/auth/actions";
import { safeNextPath } from "@/lib/auth/redirect";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sign in — SandBag" };

const ERRORS: Record<string, string> = {
  callback: "Sign-in did not complete. Please try again.",
  oauth: "Could not reach the sign-in provider. Please try again.",
  provider: "Unknown sign-in provider.",
};

const button =
  "rounded-lg border border-stone-300 bg-white px-4 py-3 font-medium hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800 dark:focus-visible:outline-stone-100";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const error =
    typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const configured = isSupabaseConfigured();

  if (configured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    // Already signed in: continue, but never back to /sign-in (loop).
    if (data.user) redirect(next.startsWith("/sign-in") ? "/account" : next);
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-20">
      <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
      <p className="text-stone-600 dark:text-stone-400">
        Sign in to upload scans and annotate climbs. You get a public handle you
        can change at any time.
      </p>
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {configured ? (
        <form action={signInWithProvider} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <button
            type="submit"
            name="provider"
            value="github"
            className={button}
          >
            Continue with GitHub
          </button>
          <button
            type="submit"
            name="provider"
            value="google"
            className={button}
          >
            Continue with Google
          </button>
        </form>
      ) : (
        <p role="status" className="text-stone-600 dark:text-stone-400">
          Sign-in is not configured on this server. See “Setting up OAuth
          locally” in the README.
        </p>
      )}
    </main>
  );
}
