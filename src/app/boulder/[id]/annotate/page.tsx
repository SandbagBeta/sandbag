import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AnnotateEditor } from "@/components/viewer/annotate/AnnotateEditor";
import { EditDenied } from "@/components/viewer/annotate/EditDenied";
import { editPath, loadEditableClimb } from "@/lib/annotations/editClimb";
import { signInPath } from "@/lib/auth/gating";
import { loadBoulder, publishedGlbUrl } from "@/lib/boulder/load";
import { getPublicSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ climb?: string | string[] }>;

export const metadata: Metadata = {
  title: "Annotate a climb — SandBag",
  robots: { index: false, follow: false },
};

/**
 * Add a climb to a published scan, or (`?climb=<id>`) edit your own climb that
 * is still waiting for review (issue #22). Signed-in only; the server action
 * re-checks the session, authorship and status and validates every hold
 * against the mesh, so this page is a convenience, not the security boundary.
 */
export default async function AnnotatePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ id }, { climb }] = await Promise.all([params, searchParams]);
  const climbParam = Array.isArray(climb) ? climb[0] : climb;
  if (!isSupabaseConfigured()) notFound();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect(
      signInPath(
        climbParam ? editPath(id, climbParam) : `/boulder/${id}/annotate`,
      ),
    );
  }

  const boulder = await loadBoulder(supabase, id);
  const hash = boulder?.scan.content_hash;
  if (!boulder || !hash) notFound();
  const { scan } = boulder;
  const src = publishedGlbUrl(getPublicSupabaseEnv().url, scan.glb_path);

  let edit;
  if (climbParam) {
    const loaded = await loadEditableClimb(
      supabase,
      scan.id,
      climbParam,
      auth.user.id,
    );
    if (!loaded.ok) {
      return (
        <EditDenied help={loaded.help} boulderHref={`/boulder/${scan.id}`} />
      );
    }
    edit = {
      climbId: loaded.climb.id,
      meta: {
        name: loaded.climb.name,
        description: loaded.climb.description,
        proposed_grade: loaded.climb.proposed_grade,
        fa_info: loaded.climb.fa_info ?? "",
      },
      holds: loaded.holds,
      paths: loaded.paths,
    };
  }

  return (
    <main className="relative h-dvh w-full">
      <AnnotateEditor
        src={src}
        label={edit ? "3D scan: editing your climb" : "3D scan to annotate"}
        scanId={scan.id}
        edit={edit}
        scale={scan.scale_factor}
        scanContentHash={hash}
        climbs={boulder.climbs}
        holds={boulder.holds}
        paths={boulder.paths}
      />
      <Link
        href={`/boulder/${scan.id}`}
        className="absolute top-4 left-4 z-20 rounded bg-white/90 px-2 py-1 text-sm underline dark:bg-stone-900/90"
      >
        Back to boulder
      </Link>
    </main>
  );
}
