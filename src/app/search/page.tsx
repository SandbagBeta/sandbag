import type { Metadata } from "next";
import Link from "next/link";
import { SearchEmpty } from "@/components/browse/SearchEmpty";
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
const field = "field";

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
    <main className="page">
      <header className="space-y-1">
        <nav aria-label="Breadcrumb">
          <Link href="/areas" className="crumb text-sm">
            Areas
          </Link>
        </nav>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Search
        </h1>
      </header>

      {/* Plain GET form: works without JavaScript and results are linkable. */}
      <form
        role="search"
        action="/search"
        className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap"
      >
        <label className="col-span-2 flex flex-col gap-1 text-sm font-medium sm:col-span-1 sm:min-w-48 sm:flex-1">
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
        <label className="flex flex-col gap-1 text-sm font-medium">
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
        <label className="flex flex-col gap-1 text-sm font-medium">
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
        <button type="submit" className="btn btn-primary col-span-2">
          Search
        </button>
      </form>

      <div aria-live="polite" className="space-y-8">
        {results.empty && <SearchEmpty kind="idle" />}
        {none && <SearchEmpty kind="none" />}

        {results.areas.length > 0 && (
          <section aria-labelledby="area-results" className="space-y-2">
            <h2
              id="area-results"
              className="font-display text-xl font-semibold"
            >
              Areas
            </h2>
            <ul className="text-sm">
              {results.areas.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/area/${a.id}`}
                    className="hover:text-moss hover:bg-surface inline-flex min-h-11 items-center rounded-md px-2 font-semibold"
                  >
                    {a.name}
                  </Link>{" "}
                  <span className="text-muted tabular-nums">
                    {a.scanCount} scan{a.scanCount === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {results.climbs.length > 0 && (
          <section aria-labelledby="climb-results" className="space-y-2">
            <h2
              id="climb-results"
              className="font-display text-xl font-semibold"
            >
              Climbs
            </h2>
            <ul className="text-sm">
              {results.climbs.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/boulder/${c.scanId}?climb=${c.id}`}
                    className="hover:text-moss hover:bg-surface inline-flex min-h-11 items-center rounded-md px-2 font-semibold"
                  >
                    {c.name}
                  </Link>{" "}
                  <span className="text-muted tabular-nums">{c.grade}</span>
                </li>
              ))}
            </ul>
            {results.climbs.length === RESULT_LIMIT && (
              <p className="text-muted text-xs">
                Showing the first {RESULT_LIMIT}. Narrow the search to see more.
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
