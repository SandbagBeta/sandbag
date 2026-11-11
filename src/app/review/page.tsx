import type { Metadata } from "next";
import Link from "next/link";
import { canReviewInUi, loadPendingScans } from "@/lib/review/queue";
import { Forbidden, getReviewer } from "./session";

export const metadata: Metadata = {
  title: "Review queue — SandBag",
  robots: { index: false },
};

export default async function ReviewQueuePage() {
  const { supabase, trust } = await getReviewer("/review");
  if (!canReviewInUi(trust)) return <Forbidden />;
  const scans = await loadPendingScans(supabase);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Review queue</h1>
      {scans.length === 0 ? (
        <p className="text-stone-600 dark:text-stone-400">
          Nothing is waiting for review.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {scans.map((s) => (
            <li key={s.id}>
              <Link
                href={`/review/${s.id}`}
                className="flex flex-col gap-1 rounded border border-stone-300 p-4 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
              >
                <span className="font-semibold">
                  Scan from {s.uploader_handle ?? "a deleted account"}
                </span>
                <span className="text-sm text-stone-600 dark:text-stone-400">
                  Uploaded {new Date(s.created_at).toISOString().slice(0, 10)}
                  {s.tri_count
                    ? ` · ${s.tri_count.toLocaleString()} triangles`
                    : ""}
                  {" · "}
                  {s.qc_warnings
                    ? `${s.qc_warnings} QC warning${s.qc_warnings === 1 ? "" : "s"}`
                    : "QC clean"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
