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

describe("saveVote", () => {
  it("upserts one row per user per climb", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const db = asDb({ from: vi.fn(() => ({ upsert })) });
    await saveVote(db, "c1", "u1", "v4");
    expect(upsert).toHaveBeenCalledWith(
      { climb_id: "c1", user_id: "u1", grade: "V4" },
      { onConflict: "climb_id,user_id" },
    );
  });
  it("rejects non-V grades without calling the db", async () => {
    const from = vi.fn();
    await expect(
      saveVote(asDb({ from }), "c1", "u1", "5.10"),
    ).rejects.toBeInstanceOf(VoteError);
    expect(from).not.toHaveBeenCalled();
  });
});
