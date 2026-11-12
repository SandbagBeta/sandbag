import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { QcChecks } from "@/components/scan-status/QcChecks";
import { RetryButton } from "@/components/scan-status/RetryButton";
import { ScanTimeline } from "@/components/scan-status/ScanTimeline";
import { signInPath } from "@/lib/auth/gating";
import {
  buildTimeline,
  canRetry,
  groupChecks,
  latestFeedback,
  STATUS_HELP,
  STATUS_LABEL,
} from "@/lib/scan-report/format";
import { loadScanReport } from "@/lib/scan-report/load";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { loadAttachNote } from "@/lib/upload/attach-note";
import { retryScan } from "./actions";

export const metadata: Metadata = {
  title: "Scan status — SandBag",
  robots: { index: false },
};

export default async function ScanStatusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  const path = `/upload/scans/${id}`;
  if (!isSupabaseConfigured()) redirect(signInPath(path));
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(signInPath(path));

  const report = await loadScanReport(supabase, id, data.user.id);
  if (!report) notFound();
  const { scan, events, reviews, retriedBy } = report;
  const attachNote = await loadAttachNote(supabase, id);
  const feedback = latestFeedback(reviews);
  const groups = groupChecks(scan.qc_report);
  const retryable = canRetry(scan.status, feedback) && !retriedBy;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/upload" className="underline">
          Upload
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          {STATUS_LABEL[scan.status]}
        </h1>
        <p className="mt-1 text-stone-600 dark:text-stone-400">
          {STATUS_HELP[scan.status]}
        </p>
        {scan.retry_of && (
          <p className="mt-1 text-sm">
            A new version of{" "}
            <Link href={`/upload/scans/${scan.retry_of}`} className="underline">
              an earlier scan
            </Link>
            .
          </p>
        )}
      </div>

      {feedback && (
        <section aria-labelledby="feedback">
          <h2 id="feedback" className="text-xl font-semibold">
            {feedback.verdict === "reject"
              ? "Why it was rejected"
              : "Changes requested"}
          </h2>
          <p className="mt-2 whitespace-pre-wrap">
            {feedback.reason ?? "The reviewer didn't leave a reason."}
          </p>
        </section>
      )}

      {attachNote && (
        <section aria-labelledby="attach-note">
          <h2 id="attach-note" className="text-xl font-semibold">
            Your note for reviewers
          </h2>
          <p className="mt-2 whitespace-pre-wrap">{attachNote}</p>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
            Private: only you and reviewers can see this.
          </p>
        </section>
      )}

      <section aria-labelledby="checks">
        <h2 id="checks" className="mb-2 text-xl font-semibold">
          Automated checks
        </h2>
        <QcChecks groups={groups} />
      </section>

      <section aria-labelledby="timeline">
        <h2 id="timeline" className="mb-2 text-xl font-semibold">
          Timeline
        </h2>
        <ScanTimeline steps={buildTimeline(events)} />
      </section>

      {retriedBy && (
        <p>
          You uploaded a new version.{" "}
          <Link href={`/upload/scans/${retriedBy.id}`} className="underline">
            See its progress
          </Link>
        </p>
      )}
      {retryable && <RetryButton scanId={scan.id} action={retryScan} />}
    </main>
  );
}
