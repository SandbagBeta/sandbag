import type { SupabaseClient } from "@supabase/supabase-js";
import { HANDLE_RE, loadPublicProfile, parseHandle } from "./load";

type Filter = [op: string, col: string, val: unknown];

function fakeDb(tables: Record<string, readonly object[]>) {
  const queries: { table: string; cols: string; filters: Filter[] }[] = [];
  const from = (table: string) => {
    const rec = { table, cols: "", filters: [] as Filter[] };
    queries.push(rec);
    const rows = () =>
      (tables[table] ?? []).filter((item) =>
        rec.filters.every(([op, col, val]) => {
          const v = (item as Record<string, unknown>)[col];
          return op === "eq" ? v === val : (val as unknown[]).includes(v);
        }),
      );
    const q = {
      select: (cols: string) => ((rec.cols = cols), q),
      eq: (c: string, v: unknown) => (rec.filters.push(["eq", c, v]), q),
      in: (c: string, v: unknown[]) => (rec.filters.push(["in", c, v]), q),
      order: () => q,
      maybeSingle: () =>
        Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: (r: (x: unknown) => unknown) => r({ data: rows(), error: null }),
    };
    return q;
  };
  return { db: { from } as unknown as SupabaseClient, queries };
}

const ME = "00000000-0000-4000-8000-00000000a001";
const OTHER = "00000000-0000-4000-8000-00000000a002";
const S = (n: number) => `00000000-0000-4000-8000-00000000b00${n}`;
const H = "a".repeat(64);

const tables = {
  profiles: [
    {
      id: ME,
      handle: "alex",
      created_at: "2026-03-05T10:00:00Z",
      email: "a@x.io",
    },
    { id: OTHER, handle: "sam", created_at: "2026-04-01T10:00:00Z" },
  ],
  scans: [
    {
      id: S(1),
      uploader_id: ME,
      status: "published",
      openbeta_area_id: null,
      glb_path: `${S(1)}/${H}.glb`,
      content_hash: H,
    },
    {
      id: S(2),
      uploader_id: ME,
      status: "pending_review",
      openbeta_area_id: null,
      glb_path: null,
      content_hash: null,
    },
    {
      id: S(3),
      uploader_id: ME,
      status: "failed_qc",
      openbeta_area_id: null,
      glb_path: null,
      content_hash: null,
    },
    {
      id: S(4),
      uploader_id: OTHER,
      status: "published",
      openbeta_area_id: null,
      glb_path: null,
      content_hash: null,
    },
    {
      id: S(5),
      uploader_id: ME,
      status: "rejected",
      openbeta_area_id: null,
      glb_path: null,
      content_hash: null,
    },
  ],
  climbs: [
    {
      id: "c1",
      scan_id: S(1),
      name: "Mine",
      proposed_grade: "V3",
      status: "published",
      created_by: ME,
    },
    {
      id: "c2",
      scan_id: S(1),
      name: "Draft",
      proposed_grade: "V4",
      status: "pending_review",
      created_by: ME,
    },
    {
      id: "c3",
      scan_id: S(4),
      name: "Theirs",
      proposed_grade: "V5",
      status: "published",
      created_by: OTHER,
    },
    // Published climb on a scan that was taken down.
    {
      id: "c4",
      scan_id: S(5),
      name: "Gone",
      proposed_grade: "V2",
      status: "published",
      created_by: ME,
    },
  ],
};

describe("parseHandle", () => {
  it.each(["alex", "a_b_9", "abc", "x".repeat(32)])("accepts %s", (h) => {
    expect(parseHandle(h)).toBe(h);
  });
  it.each([
    "",
    "ab",
    "Alex",
    "a-b",
    "x".repeat(33),
    "a b",
    "../x",
    "é__",
    null,
    5,
  ])("rejects %s", (h) => {
    expect(parseHandle(h)).toBeNull();
  });
  it("matches the profiles check constraint", () => {
    expect(HANDLE_RE.source).toBe("^[a-z0-9_]{3,32}$");
  });
});

describe("loadPublicProfile", () => {
  it("returns only published scans and climbs of that handle", async () => {
    const { db } = fakeDb(tables);
    const p = await loadPublicProfile(db, "alex");
    expect(p?.handle).toBe("alex");
    expect(p?.boulders.map((b) => b.id)).toEqual([S(1)]);
    expect(p?.climbs.map((c) => c.name)).toEqual(["Mine"]);
  });

  it("never returns private rows, other users' items, the id or the email", async () => {
    const { db } = fakeDb(tables);
    const p = await loadPublicProfile(db, "alex");
    const json = JSON.stringify(p);
    for (const leak of [
      ME,
      OTHER,
      "a@x.io",
      S(2),
      S(3),
      S(4),
      S(5),
      "Draft",
      "Theirs",
      "Gone",
      "uploader",
      "created_by",
    ]) {
      expect(json).not.toContain(leak);
    }
  });

  it("filters on published and selects no location-shaped column", async () => {
    const { db, queries } = fakeDb(tables);
    await loadPublicProfile(db, "alex");
    for (const q of queries.filter((x) =>
      ["scans", "climbs"].includes(x.table),
    )) {
      expect(q.filters).toContainEqual(["eq", "status", "published"]);
      expect(q.cols).not.toMatch(/lat|lng|bbox|coord|geo|email/i);
    }
  });

  it("is null for an unknown handle, a malformed one, and without querying", async () => {
    const { db, queries } = fakeDb(tables);
    expect(await loadPublicProfile(db, "nobody")).toBeNull();
    queries.length = 0;
    expect(await loadPublicProfile(db, "Alex")).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it("returns empty lists for a member with nothing published", async () => {
    const { db } = fakeDb({ ...tables, scans: [], climbs: [] });
    const p = await loadPublicProfile(db, "sam");
    expect(p).toMatchObject({ handle: "sam", boulders: [], climbs: [] });
  });
});
