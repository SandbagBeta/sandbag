import type { SupabaseClient } from "@supabase/supabase-js";
import { demoBoulder } from "@/lib/fixtures";
import {
  BoulderLoadError,
  describeBoulder,
  isScanId,
  loadBoulder,
  publishedGlbUrl,
} from "./load";

type Filter = [op: string, col: string, val: unknown];
type Result = { data: unknown; error: null | { message: string } };

/**
 * Records every query (table + filters) and answers from `tables`, applying
 * eq/in filters so the test proves the loader asks for the right rows.
 */
function fakeDb(tables: Record<string, readonly object[]>, failOn?: string) {
  const queries: { table: string; filters: Filter[] }[] = [];
  const from = (table: string) => {
    const filters: Filter[] = [];
    queries.push({ table, filters });
    const rows = (): Result => {
      if (failOn === table) return { data: null, error: { message: "boom" } };
      const data = (tables[table] ?? []).filter((item) => {
        const row = item as Record<string, unknown>;
        return filters.every(([op, col, val]) =>
          op === "eq"
            ? row[col] === val
            : (val as unknown[]).includes(row[col]),
        );
      });
      return { data, error: null };
    };
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => (filters.push(["eq", col, val]), q),
      in: (col: string, val: unknown[]) => (filters.push(["in", col, val]), q),
      order: () => q,
      maybeSingle: async () => {
        const r = rows();
        return { ...r, data: (r.data as unknown[] | null)?.[0] ?? null };
      },
      then: (resolve: (r: Result) => unknown) => resolve(rows()),
    };
    return q;
  };
  return { db: { from } as unknown as SupabaseClient, queries };
}

const scan = {
  ...demoBoulder.scan,
  openbeta_area_id: null,
  captured_at: null,
  created_at: "2026-11-10T00:00:00Z",
};
const published = {
  scans: [scan],
  climbs: demoBoulder.climbs,
  holds: demoBoulder.holds,
  paths: demoBoulder.paths,
};

describe("loadBoulder", () => {
  it("loads a published scan with its published climbs, holds and paths", async () => {
    const { db } = fakeDb(published);
    const data = await loadBoulder(db, scan.id);
    expect(data?.scan.id).toBe(scan.id);
    expect(data?.climbs).toHaveLength(2);
    expect(data?.holds).toHaveLength(14);
    expect(data?.paths).toHaveLength(6);
  });

  it("filters scans and climbs to published even though RLS shows uploaders their own", async () => {
    const { db, queries } = fakeDb(published);
    await loadBoulder(db, scan.id);
    for (const table of ["scans", "climbs"]) {
      const q = queries.find((x) => x.table === table);
      expect(q?.filters).toContainEqual(["eq", "status", "published"]);
    }
  });

  it("returns null for an unpublished scan, an unknown id or a malformed id", async () => {
    const draft = fakeDb({ scans: [{ ...scan, status: "pending_review" }] });
    expect(await loadBoulder(draft.db, scan.id)).toBeNull();
    const empty = fakeDb({});
    expect(await loadBoulder(empty.db, scan.id)).toBeNull();
    expect(await loadBoulder(empty.db, "../etc/passwd")).toBeNull();
    expect(empty.queries).toHaveLength(1); // the malformed id never queried
  });

  it("returns a scan with no climbs without querying holds or paths", async () => {
    const { db, queries } = fakeDb({ scans: [scan] });
    const data = await loadBoulder(db, scan.id);
    expect(data?.climbs).toEqual([]);
    expect(queries.map((q) => q.table)).toEqual(["scans", "climbs"]);
  });

  it("surfaces database errors instead of rendering a half-empty page", async () => {
    const { db } = fakeDb(published, "holds");
    await expect(loadBoulder(db, scan.id)).rejects.toThrow(BoulderLoadError);
  });
});

describe("isScanId", () => {
  it("accepts uuids only", () => {
    expect(isScanId(scan.id)).toBe(true);
    expect(isScanId(scan.id.toUpperCase())).toBe(true);
    expect(isScanId("demo")).toBe(false);
  });
});

describe("publishedGlbUrl", () => {
  it("builds the public storage URL and encodes each path segment", () => {
    expect(
      publishedGlbUrl("http://127.0.0.1:54321/", "demo/demo-boulder.glb"),
    ).toBe(
      "http://127.0.0.1:54321/storage/v1/object/public/published/demo/demo-boulder.glb",
    );
    expect(publishedGlbUrl("https://x.supabase.co", "a b/c#d.glb")).toBe(
      "https://x.supabase.co/storage/v1/object/public/published/a%20b/c%23d.glb",
    );
  });
});

describe("describeBoulder", () => {
  it("summarizes climbs and grades under the area name", () => {
    const { title, description } = describeBoulder(demoBoulder, "Split Rock");
    expect(title).toBe("Split Rock");
    expect(description).toBe(
      "3D scan of Split Rock with 2 climbs (V2, V4): Demo Arete, Sandbagged Slab.",
    );
  });

  it("falls back to a generic name and handles no climbs", () => {
    expect(describeBoulder({ climbs: [] }, null)).toEqual({
      title: "Boulder scan",
      description: "3D boulder scan. No climbs annotated yet.",
    });
    expect(describeBoulder(demoBoulder, null).description).toBe(
      "3D boulder scan with 2 climbs (V2, V4): Demo Arete, Sandbagged Slab.",
    );
  });

  it("never includes anything but names and grades", () => {
    const { description } = describeBoulder(demoBoulder, null);
    expect(description).not.toMatch(/\d+\.\d{3,}/); // no lat/lng-like numbers
  });
});
