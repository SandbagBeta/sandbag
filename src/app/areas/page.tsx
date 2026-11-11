import type { Metadata } from "next";
import Link from "next/link";
import { AreaTree } from "@/components/browse/AreaTree";
import { BoulderCards } from "@/components/browse/BoulderCards";
import { loadBrowseIndex } from "@/lib/browse/load";
import { getPublicSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// Reads the database per request. Without this, a build with Supabase
// unconfigured would prerender an empty index forever.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Areas — SandBag",
  description: "Browse 3D boulder scans by climbing area.",
  alternates: { canonical: "/areas" },
};

export default async function AreasPage() {
  const index = isSupabaseConfigured()
    ? await loadBrowseIndex(await createClient())
    : { tree: [], unlinked: [] };
  const empty = index.tree.length === 0 && index.unlinked.length === 0;

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <Link
          href="/"
          className="text-xs text-stone-600 underline hover:no-underline dark:text-stone-400"
        >
          SandBag
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Areas</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Areas with published 3D scans. Area names come from OpenBeta.
        </p>
      </header>

      {empty && (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          No boulders have been published yet.
        </p>
      )}

      {index.tree.length > 0 && (
        <section aria-labelledby="areas-heading">
          <h2 id="areas-heading" className="sr-only">
            Area index
          </h2>
          <AreaTree nodes={index.tree} />
        </section>
      )}

      {index.unlinked.length > 0 && (
        <section aria-labelledby="unlinked-heading" className="space-y-3">
          <h2 id="unlinked-heading" className="text-lg font-semibold">
            Not linked to an area yet
          </h2>
          <BoulderCards
            boulders={index.unlinked}
            supabaseUrl={getPublicSupabaseEnv().url}
          />
        </section>
      )}
    </main>
  );
}
