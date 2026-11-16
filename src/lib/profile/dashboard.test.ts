import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadMyClimbs,
  loadMyUploads,
  loadMyVotes,
  reasonFor,
} from "./dashboard";
import { resolveThumbs } from "./thumbs";

type Filter = [string, string, unknown];
function fakeDb(
  tables: Record<string, readonly object[]>,
  rpc: Record<string, { grade: string; votes: number }[]> = {},
) {
  const queries: { table: string; filters: Filter[] }[] = [];
  const from = (table: string) => {
    const rec = { table, filters: [] as Filter[] };
    queries.push(rec);
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (rec.filters.push(["eq", c, v]), q),
      in: (c: string, v: unknown) => (rec.filters.push(["in", c, v]), q),
      order: () => q,
      limit: () => q,
      then: (r: (x: unknown) => unknown) =>
        r({
          error: null,
          data: (tables[table] ?? []).filter((it) =>
            rec.filters.every(([op, c, v]) => {
              const x = (it as Record<string, unknown>)[c];
              return op === "eq" ? x === v : (v as unknown[]).includes(x);
            }),
          ),
        }),
    };
    return q;
  };
  const rpcFn = (_n: string, a: { p_climb_id: string }) =>
    Promise.resolve({ data: rpc[a.p_climb_id] ?? [], error: null });
  return { db: { from, rpc: rpcFn } as unknown as SupabaseClient, queries };
}

const ME = "00000000-0000-4000-8000-00000000a001";
const S1 = "00000000-0000-4000-8000-00000000b001";
const S2 = "00000000-0000-4000-8000-00000000b002";
const S3 = "00000000-0000-4000-8000-00000000b003";
const H = "a".repeat(64);

describe("loadMyUploads", () => {
  const tables = {
    scans: [
      {
        id: S1,
        uploader_id: ME,
        status: "published",
        glb_path: `${S1}/${H}.glb`,
        content_hash: H,
        qc_report: null,
        created_at: "2026-05-01T00:00:00Z",
      },
      {
        id: S2,
        uploader_id: ME,
        status: "failed_qc",
        glb_path: null,
        content_hash: null,
        created_at: "2026-05-02T00:00:00Z",
        qc_report: {
          pipeline_version: "1",
          checks: [
            {
              id: "tri",
              pass: false,
              severity: "error",
              message: "Too few triangles.",
            },
            {
              id: "w",
              pass: false,
              severity: "warning",
              message: "Dark texture.",
            },
          ],
        },
      },
      {
        id: S3,
        uploader_id: ME,
        status: "pending_review",
        glb_path: null,
        content_hash: null,
        qc_report: null,
        created_at: "2026-05-03T00:00:00Z",
      },
    ],
    reviews: [
      {
        id: "r1",
        subject_type: "scan",
        subject_id: S3,
        verdict: "request_changes",
        reason: "Retake the top.",
        created_at: "2026-05-04T00:00:00Z",
      },
    ],
  };

  it("maps status to tracker, reason and thumbnail", async () => {
    const out = await loadMyUploads(fakeDb(tables).db, ME);
    const by = Object.fromEntries(out.map((u) => [u.id, u]));
    expect(by[S1]?.thumb).toEqual({
      bucket: "published",
      key: `${S1}/${H}.webp`,
    });
    expect(by[S1]?.reason).toBeNull();
    expect(by[S2]?.reason).toBe("Too few triangles.");
    expect(by[S2]?.thumb).toBeNull();
    expect(by[S2]?.steps[1]?.state).toBe("problem");
    expect(by[S3]?.reason).toBe("Retake the top.");
    expect(by[S3]?.steps[2]?.label).toBe("Changes requested");
    expect(by[S3]?.thumb?.bucket).toBe("uploads");
  });

  it("only asks for the caller's own scans", async () => {
    const { db, queries } = fakeDb(tables);
    await loadMyUploads(db, ME);
    expect(queries[0]?.filters).toContainEqual(["eq", "uploader_id", ME]);
  });

  it("is empty with no uploads", async () => {
    expect(await loadMyUploads(fakeDb({}).db, ME)).toEqual([]);
  });

  it("reasonFor ignores notes on scans that moved on", () => {
    expect(
      reasonFor("published", null, { verdict: "reject", reason: "x" } as never),
    ).toBeNull();
  });
});

describe("loadMyClimbs", () => {
  it("links published to the climb page and pending to edit", async () => {
    const { db, queries } = fakeDb({
      climbs: [
        {
          id: "c1",
          name: "A",
          proposed_grade: "V3",
          status: "published",
          scan_id: S1,
          created_by: ME,
        },
        {
          id: "c2",
          name: "B",
          proposed_grade: "V4",
          status: "pending_review",
          scan_id: S1,
          created_by: ME,
        },
        {
          id: "c3",
          name: "Other",
          proposed_grade: "V4",
          status: "published",
          scan_id: S1,
          created_by: "x",
        },
      ],
    });
    const [a, b, ...rest] = await loadMyClimbs(db, ME);
    expect(rest).toEqual([]);
    expect(queries[0]?.filters).toContainEqual(["eq", "created_by", ME]);
    expect(a).toMatchObject({ climbHref: "/climb/c1", editHref: null });
    expect(b).toMatchObject({
      climbHref: null,
      editHref: `/boulder/${S1}/annotate?climb=c2`,
    });
  });
});

describe("loadMyVotes", () => {
  it("compares my grade with the community consensus", async () => {
    const { db } = fakeDb(
      {
        grade_votes: [
          { climb_id: "c1", user_id: ME, grade: "V5" },
          { climb_id: "c2", user_id: ME, grade: "V3" },
          { climb_id: "c9", user_id: ME, grade: "V3" }, // no longer published
        ],
        climbs: [
          { id: "c1", name: "A", proposed_grade: "V3", status: "published" },
          { id: "c2", name: "B", proposed_grade: "V3", status: "published" },
        ],
      },
      { c1: [{ grade: "V4", votes: 5 }], c2: [{ grade: "V3", votes: 1 }] },
    );
    const votes = await loadMyVotes(db, ME);
    expect(votes).toHaveLength(2);
    expect(votes[0]).toMatchObject({
      climbId: "c1",
      consensus: "V4",
      offset: 1,
      sandbagged: 1,
      votes: 5,
    });
    expect(votes[1]).toMatchObject({
      climbId: "c2",
      consensus: null,
      offset: null,
      sandbagged: 0,
    });
  });
});

describe("resolveThumbs", () => {
  const item = (id: string, thumb: unknown) => ({ id, thumb }) as never;
  it("gives a placeholder (null) on any storage error or without a private adapter", async () => {
    const pub = { publicUrl: ({ key }: { key: string }) => `https://p/${key}` };
    const priv = {
      signedUrl: async () => {
        throw new Error("missing");
      },
    };
    const items = [
      item("a", { bucket: "published", key: "k.webp" }),
      item("b", { bucket: "uploads", key: "u/derived/thumb.webp" }),
      item("c", null),
    ];
    expect(await resolveThumbs(items, pub, priv as never)).toEqual({
      a: "https://p/k.webp",
      b: null,
      c: null,
    });
    expect((await resolveThumbs(items, pub, null)).b).toBeNull();
  });
});
