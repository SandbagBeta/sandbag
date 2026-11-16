import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ClimbExplorer } from "@/components/viewer/climbs/ClimbExplorer";
import {
  describeBoulder,
  loadBoulder,
  publishedGlbUrl,
} from "@/lib/boulder/load";
import { getArea } from "@/lib/openbeta";
import { getPublicSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { ExportLink } from "./ExportLink";
import { ShareButton } from "./ShareButton";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Area name from the OpenBeta cache. Optional: the page works without it. */
async function areaName(areaId: string | null): Promise<string | null> {
  if (!areaId) return null;
  try {
    const res = await getArea(areaId);
    return res.status === "ok" ? res.data.area.name : null;
  } catch {
    return null; // OpenBeta or the cache is down; degrade to a generic title.
  }
}

// Shared by generateMetadata and the page within one request.
const getBoulder = cache(async (id: string) => {
  if (!isSupabaseConfigured()) return null;
  const data = await loadBoulder(await createClient(), id);
  if (!data) return null;
  const area = await areaName(data.scan.openbeta_area_id);
  return {
    data,
    area,
    src: publishedGlbUrl(getPublicSupabaseEnv().url, data.scan.glb_path),
    ...describeBoulder(data, area),
  };
});

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { id } = await params;
  const boulder = await getBoulder(id);
  if (!boulder) {
    return {
      title: "Boulder not found — SandBag",
      robots: { index: false },
    };
  }
  const path = `/boulder/${boulder.data.scan.id}`;
  // Names and grades only. No coordinates in meta or OG (PRD §2, ADR 001).
  return {
    title: `${boulder.title} — SandBag`,
    description: boulder.description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "SandBag",
      title: boulder.title,
      description: boulder.description,
      url: path,
    },
    twitter: {
      card: "summary",
      title: boulder.title,
      description: boulder.description,
    },
  };
}

export default async function BoulderPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ id }, { climb, submitted, updated }] = await Promise.all([
    params,
    searchParams,
  ]);
  const boulder = await getBoulder(id);
  if (!boulder) notFound();
  const { data, title, description, src } = boulder;

  return (
    <main>
      <ClimbExplorer
        src={src}
        label={`3D scan of ${title}`}
        climbs={data.climbs}
        holds={data.holds}
        paths={data.paths}
        initialClimbId={Array.isArray(climb) ? climb[0] : climb}
        scale={data.scan.scale_factor}
        header={
          <header className="space-y-2">
            <nav
              aria-label="Breadcrumb"
              className="text-muted flex flex-wrap items-center gap-x-1 text-sm"
            >
              <Link href="/areas" className="crumb">
                Areas
              </Link>
              {boulder.area && data.scan.openbeta_area_id && (
                <>
                  <span aria-hidden>›</span>
                  <Link
                    href={`/area/${data.scan.openbeta_area_id}`}
                    className="crumb"
                  >
                    {boulder.area}
                  </Link>
                </>
              )}
            </nav>
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {title}
            </h1>
            <p className="text-muted text-sm">{description}</p>
            <dl className="text-muted grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {data.scan.capture_app && (
                <>
                  <dt>Captured with</dt>
                  <dd>{data.scan.capture_app}</dd>
                </>
              )}
              {data.scan.tri_count !== null && (
                <>
                  <dt>Mesh</dt>
                  <dd>
                    {data.scan.tri_count.toLocaleString("en-US")} triangles
                  </dd>
                </>
              )}
              <dt>License</dt>
              <dd>
                <a
                  href="https://creativecommons.org/licenses/by-sa/4.0/"
                  className="underline underline-offset-2 hover:no-underline"
                >
                  CC BY-SA 4.0
                </a>
              </dd>
            </dl>
            <div className="flex flex-wrap items-center gap-2">
              <ShareButton title={title} />
              <ExportLink scanId={data.scan.id} />
              <Link
                href={`/boulder/${data.scan.id}/annotate`}
                className="btn btn-ghost px-3 py-1.5"
              >
                Add a climb
              </Link>
            </div>
            {updated && (
              <p
                role="status"
                className="border-moss text-moss rounded-md border p-2 text-sm"
              >
                Your changes were saved. The climb is still waiting for review.
              </p>
            )}
            {submitted && (
              <p
                role="status"
                className="border-moss text-moss rounded-md border p-2 text-sm"
              >
                Thanks. Your climb was submitted and will appear after review.
              </p>
            )}
          </header>
        }
      >
        {description} Use the climb list to explore climbs without the 3D view.
      </ClimbExplorer>
    </main>
  );
}
