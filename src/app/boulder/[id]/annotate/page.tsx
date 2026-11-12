import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AnnotateEditor } from "@/components/viewer/annotate/AnnotateEditor";
import { signInPath } from "@/lib/auth/gating";
import { loadBoulder, publishedGlbUrl } from "@/lib/boulder/load";
import { getPublicSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

type Params = Promise<{ id: string }>;

export const metadata: Metadata = {
  title: "Annotate a climb — SandBag",
  robots: { index: false, follow: false },
};

/**
 * Add a climb to a published scan (issue #22). Signed-in only; the server
 * action re-checks the session and validates every hold against the mesh, so
 * this page is a convenience, not the security boundary.
 */
export default async function AnnotatePage({ params }: { params: Params }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) notFound();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(signInPath(`/boulder/${id}/annotate`));

  const boulder = await loadBoulder(supabase, id);
  const hash = boulder?.scan.content_hash;
  if (!boulder || !hash) notFound();
  const { scan } = boulder;
  const src = publishedGlbUrl(getPublicSupabaseEnv().url, scan.glb_path);

  return (
    <main className="relative h-dvh w-full">
      <AnnotateEditor
        src={src}
        label="3D scan to annotate"
        scanId={scan.id}
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
