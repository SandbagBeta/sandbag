import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { reviewedBanner } from "@/lib/review/decide";
import { loadPendingClimbs } from "@/lib/review/climbQueue";
import { canReviewInUi, loadPendingScans } from "@/lib/review/queue";
import { getReviewer } from "./session";

export const metadata: Metadata = {
  title: "Review queue — SandBag",
  robots: { index: false },
};

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ reviewed?: string | string[] }>;
}) {
  const { reviewed } = await searchParams;
  const banner = reviewedBanner(reviewed);
  const { supabase, trust } = await getReviewer("/review");
  if (!canReviewInUi(trust)) forbidden();
  const [scans, climbs] = await Promise.all([
    loadPendingScans(supabase),
    loadPendingClimbs(supabase),
  ]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Review queue</h1>
      {banner && (
        <p
          role="status"
          className="rounded border border-emerald-700 bg-emerald-50 p-3 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          Review submitted. {banner}
        </p>
      )}
      <h2 className="text-xl font-semibold">Scans</h2>
      {scans.length === 0 ? (
        <p className="text-stone-600 dark:text-stone-400">
          No scans are waiting.
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
      <h2 className="text-xl font-semibold">Climbs</h2>
      {climbs.length === 0 ? (
        <p className="text-stone-600 dark:text-stone-400">
          No climbs are waiting.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {climbs.map((c) => (
            <li key={c.id}>
              <Link
                href={`/review/climb/${c.id}`}
                className="flex flex-col gap-1 rounded border border-stone-300 p-4 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
              >
                <span className="font-semibold">
                  {c.name} ({c.proposed_grade})
                </span>
                <span className="text-sm text-stone-600 dark:text-stone-400">
                  By {c.author_handle ?? "a deleted account"} · Proposed{" "}
                  {new Date(c.created_at).toISOString().slice(0, 10)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
