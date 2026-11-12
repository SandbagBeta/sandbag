import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { REFERENCE_PATTERN } from "@/lib/annotations/failureLog";
import { signInPath } from "@/lib/auth/gating";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { ReportForm } from "./ReportForm";

export const metadata: Metadata = {
  title: "Report a problem — SandBag",
  robots: { index: false, follow: false },
};

/**
 * The user adds a note to a save failure they hit, by its reference. The note
 * goes only to the private failure log, and only the user the failure happened
 * to can attach one (the server action and database enforce that). The page
 * shows the reference and nothing else about the log.
 */
export default async function ReportProblemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).ref;
  const ref = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  const valid = REFERENCE_PATTERN.test(ref);

  // The proxy redirects signed-out users too; this is the real check.
  const back = valid ? `/report-problem?ref=${ref}` : "/report-problem";
  if (!isSupabaseConfigured()) redirect(signInPath(back));
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(signInPath(back));

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 px-6 py-20">
      <h1 className="text-3xl font-bold tracking-tight">Report a problem</h1>
      {valid ? (
        <>
          <p>
            Reference <strong>{ref}</strong>. Tell us what you were doing when
            your climb failed to save. Only the SandBag maintainers can read
            your note.
          </p>
          <ReportForm reference={ref} />
        </>
      ) : (
        <p role="alert">
          This link is missing a valid reference (it looks like SB-ABCD2345).
          Open the link from the save message again.
        </p>
      )}
      <Link href="/" className="text-sm underline">
        Back to SandBag
      </Link>
    </main>
  );
}
