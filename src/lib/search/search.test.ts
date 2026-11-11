import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSearchParams } from "./query";
import { search, SearchError } from "./search";

type Call = [method: string, ...args: unknown[]];

/**
 * Minimal PostgREST stand-in: applies eq/in filters, and treats textSearch as
 * "every prefix term starts a word of the column" (what `simple` FTS does for
 * these names). Records the calls so tests can check the query shape.
 */
function fakeDb(
  tables: Record<string, readonly Record<string, unknown>[]>,
  fail = false,
) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const preds: ((row: Record<string, unknown>) => boolean)[] = [];
    const q = {
      select: (cols: string) => (calls.push(["select", table, cols]), q),
      eq: (col: string, val: unknown) => (
        calls.push(["eq", col, val]),
        preds.push((r) => r[col] === val),
        q
      ),
      in: (col: string, vals: unknown[]) => (
        calls.push(["in", col, vals]),
        preds.push((r) => vals.includes(r[col])),
        q
      ),
      textSearch: (col: string, query: string, opts: unknown) => {
        calls.push(["textSearch", col, query, opts]);
        const prefixes = query.split(" & ").map((t) => t.replace(/:\*$/, ""));
        preds.push((r) => {
          const words = String(r[col]).toLowerCase().split(/\s+/);
          return prefixes.every((p) => words.some((w) => w.startsWith(p)));
        });
        return q;
      },
      order: () => q,
      limit: () => q,
      then: (resolve: (r: unknown) => unknown) =>
        resolve(
          fail && table === "climbs"
            ? { data: null, error: { message: "boom" } }
            : {
                data: (tables[table] ?? []).filter((r) =>
                  preds.every((p) => p(r)),
                ),
                error: null,
              },
        ),
    };
    return q;
  };
  return { db: { from } as unknown as SupabaseClient, calls };
}

const SCAN = "00000000-0000-4000-8000-00000000b001";
const AREA = "00000000-0000-4000-8000-0000000000a3";
const climb = (id: string, name: string, grade: string, extra = {}) => ({
  id,
  scan_id: SCAN,
  name,
  proposed_grade: grade,
  status: "published",
  "scans.status": "published",
  ...extra,
});

const tables = {
  climbs: [
    climb("c1", "Lieback Crack", "V3"),
    climb("c2", "Slab Master", "V1"),
    climb("c3", "Lieback Direct", "V7"),
    climb("c4", "Lieback Draft", "V3", { status: "pending_review" }),
    climb("c5", "Lieback Takedown", "V3", { "scans.status": "rejected" }),
  ],
  scans: [
    {
      id: SCAN,
      status: "published",
      openbeta_area_id: AREA,
      glb_path: null,
      content_hash: null,
    },
  ],
  area_cache: [
    {
      openbeta_area_id: AREA,
      name: "Lieback Boulders",
      path_tokens: ["Lieback Boulders"],
      ancestors: [],
    },
  ],
};

const run = (raw: Record<string, string>, fail = false) => {
  const f = fakeDb(tables, fail);
  return { ...f, result: search(f.db, parseSearchParams(raw)) };
};

describe("search", () => {
  it("'Lieback' finds the climb (issue #31 acceptance) and the area", async () => {
    const { result } = run({ q: "Lieback" });
    const r = await result;
    expect(r.climbs.map((c) => c.name)).toEqual([
      "Lieback Crack",
      "Lieback Direct",
    ]);
    expect(r.climbs[0]).toEqual({
      id: "c1",
      scanId: SCAN,
      name: "Lieback Crack",
      grade: "V3",
    });
    expect(r.areas).toEqual([
      { id: AREA, name: "Lieback Boulders", scanCount: 1 },
    ]);
  });

  it("matches prefixes and requires every term", async () => {
    expect(
      (await run({ q: "lieb cr" }).result).climbs.map((c) => c.id),
    ).toEqual(["c1"]);
  });

  it("filters by grade range, with or without a query", async () => {
    expect(
      (await run({ q: "Lieback", min: "5" }).result).climbs.map((c) => c.id),
    ).toEqual(["c3"]);
    const byGrade = await run({ max: "2" }).result;
    expect(byGrade.climbs.map((c) => c.id)).toEqual(["c2"]);
    expect(byGrade.areas).toEqual([]);
  });

  it("asks Postgres for published climbs on published scans via FTS", async () => {
    const { calls, result } = run({ q: "Lieback" });
    await result;
    expect(calls).toContainEqual(["eq", "status", "published"]);
    expect(calls).toContainEqual(["eq", "scans.status", "published"]);
    expect(calls).toContainEqual([
      "textSearch",
      "name",
      "lieback:*",
      { config: "simple" },
    ]);
    for (const [m, , cols] of calls) {
      if (m === "select")
        expect(String(cols)).not.toMatch(/\b(lat|lng|bbox|coords?)\b|\*/);
    }
  });

  it("does no query for an empty search", async () => {
    const { calls, result } = run({ q: "  &|! " });
    expect(await result).toEqual({ climbs: [], areas: [], empty: true });
    expect(calls).toEqual([]);
  });

  it("surfaces database errors", async () => {
    await expect(run({ q: "x" }, true).result).rejects.toThrow(SearchError);
  });
});
