import { BoulderCards } from "@/components/browse/BoulderCards";
import { loadFeatured, type BoulderCard } from "@/lib/browse/load";
import { getPublicSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// Featured boulders come from the database per request.
export const dynamic = "force-dynamic";

async function featured(): Promise<BoulderCard[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    return await loadFeatured(await createClient());
  } catch {
    return []; // The pitch must render even if the database is down.
  }
}

const steps = [
  [
    "📱",
    "Scan",
    "Capture a boulder with Polycam, Scaniverse, or any app that exports GLB/OBJ/PLY.",
  ],
  ["⬆️", "Upload", "Automated quality checks, then community review."],
  ["📍", "Attach", "Link the scan to real climbing data via OpenBeta."],
  [
    "✍️",
    "Annotate",
    "Mark holds, the line, topout and downclimb. Vote grades.",
  ],
  [
    "🧗",
    "Explore",
    "Walk around the boulder in 3D before you ever touch rock.",
  ],
] as const;

export default async function Home() {
  const boulders = await featured();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-20">
      <header className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sandstone text-sm font-semibold tracking-widest uppercase">
            Pre-alpha
          </p>
          {/* Static link keeps this page static; signed-out users are sent
              to /sign-in by the proxy. */}
          <a
            href="/account"
            className="text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Sign in / Account
          </a>
        </div>
        <h1 className="text-5xl font-bold tracking-tight">SandBag</h1>
        <p className="text-lg text-stone-600 dark:text-stone-400">
          Open-source 3D boulder visualizer, built on community contribution.
        </p>
        <p className="text-sm text-stone-500 italic">
          sandbag (v.): to rate a climb easier than it actually is. We keep the
          receipts.
        </p>
        <p>
          <a
            href="/areas"
            className="inline-block rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
          >
            Browse boulders
          </a>
        </p>
      </header>

      <ol className="grid gap-4 sm:grid-cols-2">
        {steps.map(([icon, title, body]) => (
          <li
            key={title}
            className="rounded-xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900"
          >
            <div className="mb-2 flex items-center gap-2">
              <span aria-hidden="true">{icon}</span>
              <h2 className="font-semibold">{title}</h2>
            </div>
            <p className="text-sm text-stone-600 dark:text-stone-400">{body}</p>
          </li>
        ))}
      </ol>

      {boulders.length > 0 && (
        <section aria-labelledby="featured-heading" className="space-y-3">
          <h2 id="featured-heading" className="text-lg font-semibold">
            Featured boulders
          </h2>
          <BoulderCards
            boulders={boulders}
            supabaseUrl={getPublicSupabaseEnv().url}
          />
        </section>
      )}

      <section
        aria-labelledby="values-heading"
        className="space-y-2 text-sm text-stone-600 dark:text-stone-400"
      >
        <h2 id="values-heading" className="text-lg font-semibold text-inherit">
          Open by design
        </h2>
        <p>
          Code is AGPL-3.0 and contributed data is CC BY-SA 4.0, with a full
          export for every boulder. Areas flagged for access concerns never show
          a location.
        </p>
      </section>

      <section
        aria-labelledby="contribute-heading"
        className="space-y-3 rounded-xl border border-stone-200 p-5 dark:border-stone-800"
      >
        <h2 id="contribute-heading" className="text-lg font-semibold">
          Contribute a boulder
        </h2>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Got a scan? Upload it, attach it to its OpenBeta climb and help the
          community annotate it.
        </p>
        <a
          href="/upload"
          className="inline-block rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
        >
          Upload a scan
        </a>
      </section>

      <footer className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-stone-500">
        <a
          className="hover:underline"
          href="https://github.com/sandbagbeta/sandbag"
        >
          GitHub
        </a>
        <span>Code: AGPL-3.0</span>
        <span>Data: CC BY-SA 4.0</span>
        <a className="hover:underline" href="https://openbeta.io">
          Built on OpenBeta
        </a>
      </footer>
    </main>
  );
}
