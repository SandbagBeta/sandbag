import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publishedGlbUrl } from "@/lib/boulder/load";
import { CLIMB_CHECKLIST, loadReviewClimb } from "@/lib/review/climbQueue";
import { canReviewInUi } from "@/lib/review/queue";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { ReviewForm } from "../../ReviewForm";
import { Forbidden, getReviewer } from "../../session";
import { ReviewClimbViewer } from "./ReviewClimbViewer";

export const metadata: Metadata = {
  title: "Review climb — SandBag",
  robots: { index: false },
};

export default async function ReviewClimbPage({
  params,
}: {
  params: Promise<{ climbId: string }>;
}) {
  const { climbId } = await params;
  const { supabase, trust } = await getReviewer(`/review/climb/${climbId}`);
  if (!canReviewInUi(trust)) return <Forbidden />;
  const review = await loadReviewClimb(supabase, climbId);
  if (!review) notFound();
  const { climb, holds, paths } = review;
  // Climbs exist only on published scans, so the mesh is in the public bucket.
  const src = review.glb_path
    ? publishedGlbUrl(getPublicSupabaseEnv().url, review.glb_path)
    : null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/review" className="underline">
          Review queue
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          {climb.name} ({climb.proposed_grade})
        </h1>
        <p className="text-stone-600 dark:text-stone-400">
          Proposed by {climb.author_handle ?? "a deleted account"}
        </p>
        {climb.description ? <p className="mt-2">{climb.description}</p> : null}
        {climb.fa_info ? <p className="mt-1">FA: {climb.fa_info}</p> : null}
      </div>

      {src ? (
        <ReviewClimbViewer
          src={src}
          climbId={climb.id}
          holds={holds}
          paths={paths}
        >
          <p>
            3D preview of the proposed climb. The hold list below is the text
            version.
          </p>
        </ReviewClimbViewer>
      ) : (
        <p className="rounded border border-stone-300 p-4 dark:border-stone-700">
          The mesh is not available to preview.
        </p>
      )}

      <section aria-labelledby="holds">
        <h2 id="holds" className="text-xl font-semibold">
          Holds ({holds.length}) and lines ({paths.length})
        </h2>
        <ol className="mt-2 list-decimal pl-6">
          {[...holds]
            .sort((a, b) => (a.seq_order ?? 1e9) - (b.seq_order ?? 1e9))
            .map((h) => (
              <li key={h.id}>{h.type} hold</li>
            ))}
        </ol>
        <ul className="mt-2">
          {paths.map((p) => (
            <li key={p.id}>
              {p.kind}: {p.points.length} points
            </li>
          ))}
        </ul>
      </section>

      <ReviewForm
        subjectId={climb.id}
        subjectType="climb"
        checklist={CLIMB_CHECKLIST}
      />
    </main>
  );
}
