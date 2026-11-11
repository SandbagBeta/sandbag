import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { isScanId } from "@/lib/boulder/load";
import { loadDistribution, loadMyVote } from "@/lib/grades/votes";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { Climb } from "@/lib/types";
import { VotePanel } from "./VotePanel";

type Params = Promise<{ id: string }>;

type ClimbRow = Pick<
  Climb,
  "id" | "scan_id" | "name" | "description" | "proposed_grade" | "fa_info"
>;

// Shared by generateMetadata and the page within one request. Published only:
// RLS also lets uploaders read their own drafts and this page is public.
const getClimb = cache(async (id: string): Promise<ClimbRow | null> => {
  if (!isSupabaseConfigured() || !isScanId(id)) return null;
  const { data, error } = await (
    await createClient()
  )
    .from("climbs")
    .select("id, scan_id, name, description, proposed_grade, fa_info")
    .eq("id", id.toLowerCase())
    .eq("status", "published")
    .maybeSingle();
  if (error) throw new Error(`Could not load climb: ${error.message}`);
  return data as ClimbRow | null;
});

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const climb = await getClimb((await params).id);
  if (!climb)
    return { title: "Climb not found — SandBag", robots: { index: false } };
  return {
    title: `${climb.name} ${climb.proposed_grade} — SandBag`,
    description: `Community grade votes for ${climb.name} (${climb.proposed_grade}).`,
    alternates: { canonical: `/climb/${climb.id}` },
  };
}

export default async function ClimbPage({ params }: { params: Params }) {
  const climb = await getClimb((await params).id);
  if (!climb) notFound();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const [distribution, myVote] = await Promise.all([
    loadDistribution(supabase, climb.id),
    user ? loadMyVote(supabase, climb.id, user.id) : Promise.resolve(null),
  ]);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <header className="space-y-2">
        <nav
          aria-label="Breadcrumb"
          className="text-xs text-stone-600 dark:text-stone-400"
        >
          <Link
            href={`/boulder/${climb.scan_id}?climb=${climb.id}`}
            className="underline hover:no-underline"
          >
            View on the 3D boulder
          </Link>
        </nav>
        <h1 className="text-3xl font-bold tracking-tight">
          {climb.name}{" "}
          <span className="font-normal text-stone-600 dark:text-stone-400">
            {climb.proposed_grade}
          </span>
        </h1>
        <p className="text-sm">{climb.description}</p>
        {climb.fa_info && (
          <p className="text-xs text-stone-600 dark:text-stone-400">
            FA: {climb.fa_info}
          </p>
        )}
      </header>
      <VotePanel
        climbId={climb.id}
        proposedGrade={climb.proposed_grade}
        distribution={distribution}
        myVote={myVote}
        canVote={!!user}
      />
      {!user && (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          <Link
            href={`/sign-in?next=${encodeURIComponent(`/climb/${climb.id}`)}`}
            className="underline hover:no-underline"
          >
            Sign in
          </Link>{" "}
          to add your grade.
        </p>
      )}
    </main>
  );
}
