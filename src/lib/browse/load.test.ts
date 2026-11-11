import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BrowseLoadError,
  loadAreaPage,
  loadBrowseIndex,
  loadFeatured,
  sortGrades,
  thumbPathFor,
} from "./load";

type Filter = [op: string, col: string, val: unknown];
type Result = { data: unknown; error: null | { message: string } };

/** Answers from `tables`, applying eq/in filters; records selected columns. */
function fakeDb(tables: Record<string, readonly object[]>, failOn?: string) {
  const selects: { table: string; cols: string }[] = [];
  const from = (table: string) => {
    const filters: Filter[] = [];
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
      select: (cols: string) => (selects.push({ table, cols }), q),
      eq: (col: string, val: unknown) => (filters.push(["eq", col, val]), q),
      in: (col: string, val: unknown[]) => (filters.push(["in", col, val]), q),
      order: () => q,
      then: (resolve: (r: Result) => unknown) => resolve(rows()),
    };
    return q;
  };
  return { db: { from } as unknown as SupabaseClient, selects };
}

const NH = "00000000-0000-4000-8000-0000000000a2";
const PAW = "00000000-0000-4000-8000-0000000000a3";
const S1 = "00000000-0000-4000-8000-00000000b001";
const S2 = "00000000-0000-4000-8000-00000000b002";
const S3 = "00000000-0000-4000-8000-00000000b003";
const HASH = "a".repeat(64);

const tables = {
  scans: [
    {
      id: S1,
      status: "published",
      openbeta_area_id: PAW,
      glb_path: `${S1}/${HASH}.glb`,
      content_hash: HASH,
    },
    {
      id: S2,
      status: "published",
      openbeta_area_id: null,
      glb_path: "demo/demo-boulder.glb",
      content_hash: HASH,
    },
    // Visible to its uploader through RLS, but not published: never listed.
    {
      id: S3,
      status: "pending_review",
      openbeta_area_id: PAW,
      glb_path: null,
      content_hash: null,
    },
  ],
  climbs: [
    { scan_id: S1, name: "Arete", proposed_grade: "V10", status: "published" },
    { scan_id: S1, name: "Slab", proposed_grade: "V2", status: "published" },
    {
      scan_id: S1,
      name: "Draft",
      proposed_grade: "V5",
      status: "pending_review",
    },
  ],
  area_cache: [
    {
      openbeta_area_id: PAW,
      name: "Pawtuckaway",
      path_tokens: ["New Hampshire", "Pawtuckaway"],
      ancestors: [NH],
    },
  ],
};

describe("loadBrowseIndex", () => {
  it("builds the tree from published scans and lists unlinked ones", async () => {
    const { db } = fakeDb(tables);
    const index = await loadBrowseIndex(db);
    expect(index.tree.map((n) => [n.name, n.scanCount])).toEqual([
      ["New Hampshire", 1],
    ]);
    expect(index.unlinked.map((b) => b.id)).toEqual([S2]);
    expect(index.unlinked[0]).toMatchObject({
      thumbPath: null,
      climbNames: [],
      grades: [],
    });
  });

  it("never selects coordinate columns", async () => {
    const { db, selects } = fakeDb(tables);
    await loadAreaPage(db, PAW);
    for (const { cols } of selects) {
      expect(cols).not.toMatch(/\b(lat|lng|bbox|coords?)\b|\*/);
    }
  });

  it("surfaces query errors", async () => {
    await expect(loadBrowseIndex(fakeDb(tables, "scans").db)).rejects.toThrow(
      BrowseLoadError,
    );
  });
});

describe("loadAreaPage", () => {
  it("returns the area's published boulders with climbs and grades", async () => {
    const page = await loadAreaPage(fakeDb(tables).db, PAW.toUpperCase());
    expect(page?.name).toBe("Pawtuckaway");
    expect(page?.breadcrumb.map((c) => c.name)).toEqual([
      "New Hampshire",
      "Pawtuckaway",
    ]);
    expect(page?.boulders).toEqual([
      {
        id: S1,
        thumbPath: `${S1}/${HASH}.webp`,
        climbNames: ["Arete", "Slab"],
        grades: ["V2", "V10"],
      },
    ]);
  });

  it("lists sub-areas for a parent area", async () => {
    const page = await loadAreaPage(fakeDb(tables).db, NH);
    expect(page?.children.map((c) => c.name)).toEqual(["Pawtuckaway"]);
    expect(page?.boulders).toEqual([]);
    expect(page?.breadcrumb.map((c) => c.name)).toEqual(["New Hampshire"]);
  });

  it("is null for malformed ids and areas with nothing published", async () => {
    const { db } = fakeDb(tables);
    expect(await loadAreaPage(db, "nope")).toBeNull();
    expect(
      await loadAreaPage(db, "00000000-0000-4000-8000-0000000000ff"),
    ).toBeNull();
  });
});

describe("helpers", () => {
  it("derives the thumbnail key only for the ADR 002 layout", () => {
    expect(
      thumbPathFor({
        id: S1,
        openbeta_area_id: null,
        glb_path: `${S1}/${HASH}.glb`,
        content_hash: HASH,
      }),
    ).toBe(`${S1}/${HASH}.webp`);
    expect(
      thumbPathFor({
        id: S1,
        openbeta_area_id: null,
        glb_path: "demo/x.glb",
        content_hash: HASH,
      }),
    ).toBeNull();
    expect(
      thumbPathFor({
        id: S1,
        openbeta_area_id: null,
        glb_path: null,
        content_hash: null,
      }),
    ).toBeNull();
  });

  it("sorts V grades numerically and dedupes", () => {
    expect(sortGrades(["V10", "V2", "V2", "5.10a", "V0"])).toEqual([
      "V0",
      "V2",
      "V10",
      "5.10a",
    ]);
  });
});

describe("loadFeatured", () => {
  it("returns at most `limit` published scans", async () => {
    const { db } = fakeDb(tables);
    expect(await loadFeatured(db, 1)).toHaveLength(1);
  });
});
