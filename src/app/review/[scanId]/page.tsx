import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { BoulderViewer } from "@/components/viewer";
import { CHECKLIST, canReviewInUi, loadReviewScan } from "@/lib/review/queue";
import { storageFor } from "@/lib/storage";
import { createServiceClient } from "@/lib/supabase/service";
import { loadAttachNote } from "@/lib/upload/attach-note";
import { ReviewForm } from "../ReviewForm";
import { getReviewer } from "../session";

export const metadata: Metadata = {
  title: "Review scan — SandBag",
  robots: { index: false },
};

/**
 * Pending meshes are private. Assumes the canonical GLB sits in the private
 * `uploads` bucket while pending (ADR 002 §3); the maintainer check above is
 * what authorizes minting this short-lived signed URL.
 */
async function pendingGlbUrl(glbPath: string | null): Promise<string | null> {
  if (!glbPath) return null;
  try {
    return await storageFor(createServiceClient()).signedUrl(
      { bucket: "uploads", key: glbPath },
      3600,
    );
  } catch {
    return null;
  }
}

export default async function ReviewScanPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = await params;
  const { supabase, trust } = await getReviewer(`/review/${scanId}`);
  if (!canReviewInUi(trust)) forbidden();
  const scan = await loadReviewScan(supabase, scanId);
  if (!scan) notFound();
  const src = await pendingGlbUrl(scan.glb_path);
  // Session client, not service role: RLS limits the note to reviewers/uploader.
  const attachNote = await loadAttachNote(supabase, scan.id);
  const checks = scan.qc_report?.checks ?? [];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/review" className="underline">
          Review queue
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Scan from {scan.uploader_handle ?? "a deleted account"}
        </h1>
      </div>

      {src ? (
        <BoulderViewer
          src={src}
          label="3D scan under review"
          className="h-96 w-full rounded border border-stone-300 dark:border-stone-700"
        >
          <p>3D scan under review. The QC report below describes it in text.</p>
        </BoulderViewer>
      ) : (
        <p className="rounded border border-stone-300 p-4 dark:border-stone-700">
          The mesh is not available to preview yet.
        </p>
      )}

      {attachNote && (
        <section aria-labelledby="attach-note">
          <h2 id="attach-note" className="text-xl font-semibold">
            Uploader&apos;s note (private)
          </h2>
          <p className="mt-2 whitespace-pre-wrap">{attachNote}</p>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
            The uploader couldn&apos;t find this boulder in OpenBeta. Don&apos;t
            copy this text into public fields.
          </p>
        </section>
      )}

      <section aria-labelledby="qc">
        <h2 id="qc" className="text-xl font-semibold">
          QC report
        </h2>
        {checks.length === 0 ? (
          <p>No QC report on file.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {checks.map((c) => (
              <li key={c.id}>
                <strong>{c.pass ? "Pass" : c.severity}</strong> · {c.id}:{" "}
                {c.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReviewForm subjectId={scan.id} checklist={CHECKLIST} />
    </main>
  );
}
