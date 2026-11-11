import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AreaTree } from "@/components/browse/AreaTree";
import { BoulderCards } from "@/components/browse/BoulderCards";
import { loadAreaPage } from "@/lib/browse/load";
import { getPublicSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

type Params = Promise<{ id: string }>;

// Shared by generateMetadata and the page within one request.
const getArea = cache(async (id: string) =>
  isSupabaseConfigured() ? loadAreaPage(await createClient(), id) : null,
);

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const area = await getArea((await params).id);
  if (!area)
    return { title: "Area not found — SandBag", robots: { index: false } };
  // Names only. No coordinates in meta or OG (PRD §2, ADR 001).
  const description = `3D boulder scans in ${area.breadcrumb.map((c) => c.name).join(" › ")}.`;
  return {
    title: `${area.name} — SandBag`,
    description,
    alternates: { canonical: `/area/${area.id}` },
    openGraph: {
      type: "website",
      siteName: "SandBag",
      title: area.name,
      description,
    },
  };
}

export default async function AreaPage({ params }: { params: Params }) {
  const area = await getArea((await params).id);
  if (!area) notFound();
  const parents = area.breadcrumb.slice(0, -1);

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap gap-1 text-xs text-stone-600 dark:text-stone-400">
            <li>
              <Link href="/areas" className="underline hover:no-underline">
                Areas
              </Link>
            </li>
            {parents.map((c) => (
              <li key={c.id} className="before:mr-1 before:content-['›']">
                <Link
                  href={`/area/${c.id}`}
                  className="underline hover:no-underline"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        <h1 className="text-3xl font-bold tracking-tight">{area.name}</h1>
      </header>

      {area.children.length > 0 && (
        <section aria-labelledby="sub-areas-heading" className="space-y-3">
          <h2 id="sub-areas-heading" className="text-lg font-semibold">
            Areas
          </h2>
          <AreaTree nodes={area.children} />
        </section>
      )}

      {area.boulders.length > 0 && (
        <section aria-labelledby="boulders-heading" className="space-y-3">
          <h2 id="boulders-heading" className="text-lg font-semibold">
            Boulders
          </h2>
          <BoulderCards
            boulders={area.boulders}
            supabaseUrl={getPublicSupabaseEnv().url}
          />
        </section>
      )}
    </main>
  );
}
