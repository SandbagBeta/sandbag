import type { Metadata } from "next";
import Link from "next/link";
import { MAX_V, MIN_V, parseSearchParams } from "@/lib/search/query";
import { RESULT_LIMIT, search } from "@/lib/search/search";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const metadata: Metadata = {
  title: "Search — SandBag",
  description: "Find boulders and climbs by name and grade.",
  // Result pages are thin and endless; index the browse pages instead.
  robots: { index: false },
};

const V = Array.from({ length: MAX_V - MIN_V + 1 }, (_, i) => MIN_V + i);
const field =
  "rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = parseSearchParams(await searchParams);
  const results = isSupabaseConfigured()
    ? await search(await createClient(), params)
    : { climbs: [], areas: [], empty: true };
  const none =
    !results.empty && results.climbs.length === 0 && results.areas.length === 0;

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <nav
          aria-label="Breadcrumb"
          className="text-xs text-stone-600 dark:text-stone-400"
        >
          <Link href="/areas" className="underline hover:no-underline">
            Areas
          </Link>
        </nav>
        <h1 className="text-3xl font-bold tracking-tight">Search</h1>
      </header>

      {/* Plain GET form: works without JavaScript and results are linkable. */}
      <form
        role="search"
        action="/search"
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
          Name
          <input
            type="search"
            name="q"
            defaultValue={params.q}
            placeholder="Climb or area, e.g. Lieback"
            maxLength={100}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Min grade
          <select name="min" defaultValue={params.minV ?? ""} className={field}>
            <option value="">Any</option>
            {V.map((v) => (
              <option key={v} value={v}>
                V{v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Max grade
          <select name="max" defaultValue={params.maxV ?? ""} className={field}>
            <option value="">Any</option>
            {V.map((v) => (
              <option key={v} value={v}>
                V{v}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-stone-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-stone-100 dark:text-stone-900"
        >
          Search
        </button>
      </form>

      <div aria-live="polite" className="space-y-8">
        {none && (
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Nothing published matches. Try fewer words or a wider grade range.
          </p>
        )}

        {results.areas.length > 0 && (
          <section aria-labelledby="area-results" className="space-y-2">
            <h2 id="area-results" className="text-lg font-semibold">
              Areas
            </h2>
            <ul className="space-y-1 text-sm">
              {results.areas.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/area/${a.id}`}
                    className="font-medium hover:underline"
                  >
                    {a.name}
                  </Link>{" "}
                  <span className="text-stone-600 tabular-nums dark:text-stone-400">
                    {a.scanCount} scan{a.scanCount === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {results.climbs.length > 0 && (
          <section aria-labelledby="climb-results" className="space-y-2">
            <h2 id="climb-results" className="text-lg font-semibold">
              Climbs
            </h2>
            <ul className="space-y-1 text-sm">
              {results.climbs.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/boulder/${c.scanId}?climb=${c.id}`}
                    className="font-medium hover:underline"
                  >
                    {c.name}
                  </Link>{" "}
                  <span className="text-stone-600 tabular-nums dark:text-stone-400">
                    {c.grade}
                  </span>
                </li>
              ))}
            </ul>
            {results.climbs.length === RESULT_LIMIT && (
              <p className="text-xs text-stone-600 dark:text-stone-400">
                Showing the first {RESULT_LIMIT}. Narrow the search to see more.
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
