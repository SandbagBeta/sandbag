import type { Metadata } from "next";
import Link from "next/link";
import { AreaTree } from "@/components/browse/AreaTree";
import { BoulderCards } from "@/components/browse/BoulderCards";
import { EmptyState } from "@/components/site/EmptyState";
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
    <main className="page">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Areas
        </h1>
        <p className="text-muted text-sm">
          Areas with published 3D scans. Area names come from OpenBeta.
        </p>
        <p>
          <Link
            href="/search"
            className="text-moss inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4 hover:no-underline"
          >
            Search by climb name or grade
          </Link>
        </p>
      </header>

      {empty && (
        <EmptyState
          title="No boulders yet"
          actions={
            <>
              <Link href="/upload" className="btn btn-primary">
                Contribute a scan
              </Link>
              <Link href="/search" className="btn btn-ghost">
                Search
              </Link>
            </>
          }
        >
          Nothing has been published here so far. Scan a boulder and upload it
          to put the first one on the map.
        </EmptyState>
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
          <h2
            id="unlinked-heading"
            className="font-display text-xl font-semibold"
          >
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
