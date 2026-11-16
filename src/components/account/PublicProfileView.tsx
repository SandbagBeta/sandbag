import Link from "next/link";
import { BoulderCards } from "@/components/browse/BoulderCards";
import { EmptyState } from "@/components/site/EmptyState";
import type { PublicProfile } from "@/lib/profile/load";

export const memberSince = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));

/** Public, published-only. Takes already-filtered data; shows no ids or locations. */
export function PublicProfileView({
  profile,
  supabaseUrl,
}: {
  profile: PublicProfile;
  supabaseUrl: string;
}) {
  const { boulders, climbs } = profile;
  return (
    <main className="page">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          @{profile.handle}
        </h1>
        <p className="text-muted text-sm">
          Member since{" "}
          <time dateTime={profile.memberSince}>
            {memberSince(profile.memberSince)}
          </time>
        </p>
      </header>
      {boulders.length === 0 && climbs.length === 0 ? (
        <EmptyState title="Nothing published yet">
          @{profile.handle} hasn&apos;t published a scan or a climb.
        </EmptyState>
      ) : (
        <>
          <section aria-labelledby="scans-heading" className="space-y-3">
            <h2
              id="scans-heading"
              className="font-display text-xl font-semibold"
            >
              Scans
            </h2>
            {boulders.length === 0 ? (
              <p className="text-muted text-sm">No published scans.</p>
            ) : (
              <BoulderCards boulders={boulders} supabaseUrl={supabaseUrl} />
            )}
          </section>
          <section aria-labelledby="climbs-heading" className="space-y-3">
            <h2
              id="climbs-heading"
              className="font-display text-xl font-semibold"
            >
              Climbs
            </h2>
            {climbs.length === 0 ? (
              <p className="text-muted text-sm">No published climbs.</p>
            ) : (
              <ul className="divide-line border-line bg-surface divide-y rounded-xl border">
                {climbs.map((c) => (
                  <li key={c.id} className="px-3">
                    <Link
                      href={`/climb/${c.id}`}
                      className="flex min-h-11 items-center justify-between gap-3 py-2"
                    >
                      <span className="font-semibold underline-offset-4 hover:underline">
                        {c.name}
                      </span>
                      <span className="text-muted tabular-nums">{c.grade}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
