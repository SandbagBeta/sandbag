import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  loadDistribution,
  rowsToDistribution,
  saveVote,
  VoteError,
} from "./votes";

const asDb = (o: unknown) => o as SupabaseClient;

describe("rowsToDistribution", () => {
  it("maps rows to grade -> count", () => {
    expect(
      rowsToDistribution([
        { grade: "V4", votes: 3 },
        { grade: "V5", votes: 1 },
      ]),
    ).toEqual({ V4: 3, V5: 1 });
  });
  it("normalises case, merges duplicates, drops junk", () => {
    expect(
      rowsToDistribution([
        { grade: "v4", votes: 1 },
        { grade: "V4", votes: 2 },
        { grade: "5.10a", votes: 9 },
        { grade: "V6", votes: 0 },
        { grade: "V7", votes: -2 },
        { grade: "V8", votes: Number.NaN },
      ]),
    ).toEqual({ V4: 3 });
  });
  it("handles null and empty", () => {
    expect(rowsToDistribution(null)).toEqual({});
    expect(rowsToDistribution([])).toEqual({});
  });
});

describe("loadDistribution", () => {
  it("calls the RPC and maps rows", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [{ grade: "V3", votes: 2 }], error: null });
    const d = await loadDistribution(asDb({ rpc }), "c1");
    expect(rpc).toHaveBeenCalledWith("climb_grade_distribution", {
      p_climb_id: "c1",
    });
    expect(d).toEqual({ V3: 2 });
  });
  it("throws on error", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(loadDistribution(asDb({ rpc }), "c1")).rejects.toBeInstanceOf(
      VoteError,
    );
  });
});

type PgErr = { message: string; code?: string };

/** A fake grade_votes client: records calls; update and insert answer from the options. */
function voteDb(opts: {
  updates: { rows?: unknown[]; error?: PgErr }[];
  insert?: { error: PgErr | null };
}) {
  const calls: string[] = [];
  const updates = [...opts.updates];
  const eq = vi.fn();
  const db = {
    from: () => ({
      update: (v: unknown) => {
        calls.push(`update ${JSON.stringify(v)}`);
        const next = updates.shift() ?? { rows: [] };
        const chain = {
          eq: (...a: unknown[]) => (eq(...a), chain),
          select: async () => ({
            data: next.error ? null : (next.rows ?? []),
            error: next.error ?? null,
          }),
        };
        return chain;
      },
      insert: async (v: unknown) => {
        calls.push(`insert ${JSON.stringify(v)}`);
        return opts.insert ?? { error: null };
      },
      upsert: () => {
        throw new Error(
          "upsert writes climb_id and user_id, which the grant refuses",
        );
      },
    }),
  };
  return { db: asDb(db), calls, eq };
}
const ROW = [{ climb_id: "c1" }];
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => (e instanceof VoteError ? e.code : e),
  );

describe("saveVote", () => {
  it("changes an existing vote with one update of the grade only", async () => {
    const t = voteDb({ updates: [{ rows: ROW }] });
    await saveVote(t.db, "c1", "u1", "v4");
    expect(t.calls).toEqual(['update {"grade":"V4"}']);
    expect(t.eq).toHaveBeenCalledWith("climb_id", "c1");
    expect(t.eq).toHaveBeenCalledWith("user_id", "u1");
  });

  it("inserts the first vote when there is nothing to update", async () => {
    const t = voteDb({ updates: [{ rows: [] }] });
    await saveVote(t.db, "c1", "u1", "v4");
    expect(t.calls).toEqual([
      'update {"grade":"V4"}',
      'insert {"climb_id":"c1","user_id":"u1","grade":"V4"}',
    ]);
  });

  it("updates again when a concurrent request inserted the row first (23505)", async () => {
    const t = voteDb({
      updates: [{ rows: [] }, { rows: ROW }],
      insert: { error: { message: "duplicate key", code: "23505" } },
    });
    await saveVote(t.db, "c1", "u1", "V4");
    expect(t.calls.map((c) => c.split(" ")[0])).toEqual([
      "update",
      "insert",
      "update",
    ]);
  });

  it("fails if the second update still finds no row", async () => {
    const t = voteDb({
      updates: [{ rows: [] }, { rows: [] }],
      insert: { error: { message: "duplicate key", code: "23505" } },
    });
    expect(await codeOf(saveVote(t.db, "c1", "u1", "V4"))).toBe("error");
  });

  it("rejects non-V grades without calling the db", async () => {
    const from = vi.fn();
    expect(await codeOf(saveVote(asDb({ from }), "c1", "u1", "5.10"))).toBe(
      "invalid_grade",
    );
    expect(from).not.toHaveBeenCalled();
  });

  const rls = {
    message: "new row violates row-level security policy",
    code: "42501",
  };
  it.each([
    [
      "row-level security on update",
      { updates: [{ error: rls }] },
      "not_published",
    ],
    [
      "row-level security on insert",
      { updates: [{ rows: [] }], insert: { error: rls } },
      "not_published",
    ],
    [
      "a missing climb (FK)",
      {
        updates: [{ rows: [] }],
        insert: { error: { message: "fk", code: "23503" } },
      },
      "unknown_climb",
    ],
    [
      "a column privilege problem",
      {
        updates: [
          {
            error: {
              message: "permission denied for table grade_votes",
              code: "42501",
            },
          },
        ],
      },
      "error",
    ],
    [
      "any other database error",
      {
        updates: [{ rows: [] }],
        insert: { error: { message: "boom", code: "XX000" } },
      },
      "error",
    ],
  ])("classifies %s", async (_name, opts, expected) => {
    const t = voteDb(opts as Parameters<typeof voteDb>[0]);
    expect(await codeOf(saveVote(t.db, "c1", "u1", "V4"))).toBe(expected);
  });
});
