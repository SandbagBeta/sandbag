import { StepIcon, type StepIconName } from "@/components/landing/StepIcon";
import { HeroVisual } from "@/components/landing/HeroVisual";
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

const steps: readonly (readonly [StepIconName, string, string])[] = [
  [
    "scan",
    "Scan",
    "Capture a boulder with Polycam, Scaniverse, or any app that exports GLB/OBJ/PLY.",
  ],
  ["upload", "Upload", "Automated quality checks, then community review."],
  ["attach", "Attach", "Link the scan to real climbing data via OpenBeta."],
  [
    "annotate",
    "Annotate",
    "Mark holds, the line, topout and downclimb. Vote grades.",
  ],
  [
    "explore",
    "Explore",
    "Walk around the boulder in 3D before you ever touch rock.",
  ],
];

const values = [
  ["Open code", "AGPL-3.0, built in the open."],
  ["Open data", "CC BY-SA 4.0 with a full export for every boulder."],
  ["Access first", "Areas flagged for access concerns never show a location."],
] as const;

export default async function Home() {
  const boulders = await featured();
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-16 px-4 pb-4 sm:px-6">
      <section
        aria-labelledby="hero-heading"
        className="relative isolate py-16 sm:py-24"
      >
        <div
          aria-hidden="true"
          className="topo absolute inset-y-0 -right-4 -left-4 -z-10 sm:-right-6 sm:-left-6"
        />
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-12">
          <div className="flex max-w-2xl flex-col gap-5">
            <p className="text-sandstone text-sm font-semibold tracking-widest uppercase">
              Pre-alpha
            </p>
            <h1
              id="hero-heading"
              className="font-display text-6xl font-semibold tracking-tight sm:text-7xl"
            >
              SandBag
            </h1>
            <p className="text-muted text-lg sm:text-xl">
              Open-source 3D boulder visualizer, built on community
              contribution.
            </p>
            <p className="text-muted text-sm italic">
              sandbag (v.): to rate a climb easier than it actually is. We keep
              the receipts.
            </p>
            <p className="sr-only">
              Beside this text, a 3D scan of the demo boulder turns slowly with
              the line of the Demo Arete climb glowing over its holds.
            </p>
            <p className="flex flex-wrap gap-3 pt-2">
              <a href="/areas" className="btn btn-primary">
                Browse boulders
              </a>
              <a href="/search" className="btn btn-ghost">
                Search climbs
              </a>
            </p>
          </div>
          <HeroVisual />
        </div>
      </section>

      <section aria-labelledby="how-heading" className="space-y-6">
        <h2
          id="how-heading"
          className="font-display text-3xl font-semibold tracking-tight"
        >
          From phone scan to walkable boulder
        </h2>
        <ol className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map(([icon, title, body], i) => (
            <li key={title} className="border-line border-t pt-4">
              <div className="text-moss mb-3 flex items-center justify-between">
                <StepIcon name={icon} />
                <span className="text-muted text-xs font-semibold tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="font-display text-lg font-semibold">{title}</h3>
              <p className="text-muted mt-1 text-sm">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {boulders.length > 0 && (
        <section aria-labelledby="featured-heading" className="space-y-3">
          <h2
            id="featured-heading"
            className="font-display text-3xl font-semibold tracking-tight"
          >
            Featured boulders
          </h2>
          <BoulderCards
            boulders={boulders}
            supabaseUrl={getPublicSupabaseEnv().url}
          />
        </section>
      )}

      <section aria-labelledby="values-heading" className="space-y-6">
        <h2
          id="values-heading"
          className="font-display text-3xl font-semibold tracking-tight"
        >
          Open by design
        </h2>
        <dl className="grid gap-6 sm:grid-cols-3">
          {values.map(([term, desc]) => (
            <div key={term} className="border-moss border-l-2 pl-4">
              <dt className="font-semibold">{term}</dt>
              <dd className="text-muted mt-1 text-sm">{desc}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        aria-labelledby="contribute-heading"
        className="band flex flex-col gap-4 rounded-2xl p-6 sm:p-10"
      >
        <h2
          id="contribute-heading"
          className="font-display text-3xl font-semibold tracking-tight"
        >
          Contribute a boulder
        </h2>
        <p className="max-w-xl">
          Got a scan? Upload it, attach it to its OpenBeta climb and help the
          community annotate it.
        </p>
        <p>
          <a href="/upload" className="btn btn-band">
            Upload a scan
          </a>
        </p>
      </section>
    </main>
  );
}
