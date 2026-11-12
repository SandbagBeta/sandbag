import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  cleanDetail,
  logFailure,
  newReference,
  REFERENCE_PATTERN,
  reportFailure,
  reportPathFor,
} from "./failureLog";

const USER = "22222222-2222-4222-8222-222222222222";

describe("references", () => {
  it("are SB- plus 8 easy-to-read characters (no I, L, O, U)", () => {
    for (let i = 0; i < 200; i++) {
      const r = newReference();
      expect(r).toMatch(REFERENCE_PATTERN);
      expect(r).not.toMatch(/[ILOU]/);
    }
  });

  it("are deterministic for given bytes and don't repeat across calls", () => {
    expect(newReference(new Uint8Array(8))).toBe("SB-00000000");
    expect(newReference(new Uint8Array([31, 31, 31, 31, 31, 31, 31, 31]))).toBe(
      "SB-ZZZZZZZZ",
    );
    expect(
      new Set(Array.from({ length: 100 }, () => newReference())).size,
    ).toBe(100);
  });

  it("build a relative report link", () => {
    expect(reportPathFor("SB-0123ABCD")).toBe(
      "/report-problem?ref=SB-0123ABCD",
    );
  });
});

describe("cleanDetail keeps the private log free of anything sensitive", () => {
  it("collapses control characters and whitespace to one line", () => {
    expect(cleanDetail("a\n\tb\u0000c   d")).toBe("a b c d");
  });
  it("removes anything that looks like a coordinate pair", () => {
    expect(cleanDetail("failed near 41.12345, -74.54321 ok")).toBe(
      "failed near [removed] ok",
    );
    expect(cleanDetail("v 1.5 and 2.25")).toBe("v 1.5 and 2.25");
  });
  it("truncates to 500 characters", () => {
    expect(cleanDetail("x".repeat(900))!.length).toBe(500);
  });
  it("returns null for empty or non-text input", () => {
    expect(cleanDetail("   ")).toBeNull();
    expect(cleanDetail(undefined)).toBeNull();
    expect(cleanDetail(42)).toBeNull();
  });
});

function fakeDb(result: { error: { message: string } | null } | "throw") {
  const insert = vi.fn<(row: Record<string, unknown>) => Promise<unknown>>(
    async () => {
      if (result === "throw") throw new Error("network");
      return result;
    },
  );
  const rpc = vi.fn();
  return {
    db: { from: () => ({ insert }), rpc } as unknown as SupabaseClient,
    insert,
    rpc,
  };
}

describe("logFailure", () => {
  const entry = {
    reference: "SB-0123ABCD",
    stage: "database" as const,
    code: "error",
    userId: USER,
    scanId: "s",
    detail: "boom at 41.12345, -74.54321",
    context: { holds: 3 },
  };

  it("writes one row with the cleaned detail and returns true", async () => {
    const { db, insert } = fakeDb({ error: null });
    expect(await logFailure(db, entry)).toBe(true);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: "SB-0123ABCD",
        stage: "database",
        user_id: USER,
        detail: "boom at [removed]",
        context: { holds: 3 },
        climb_id: null,
      }),
    );
  });

  it("never throws: a log failure returns false", async () => {
    expect(
      await logFailure(fakeDb({ error: { message: "x" } }).db, entry),
    ).toBe(false);
    expect(await logFailure(fakeDb("throw").db, entry)).toBe(false);
  });
});

describe("reportFailure", () => {
  it("rejects a bad reference and an empty or huge note before calling the database", async () => {
    const { db, rpc } = fakeDb({ error: null });
    expect(await reportFailure(db, USER, "nope", "hi")).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await reportFailure(db, USER, "SB-0123ABCD", "   ")).toMatchObject({
      ok: false,
      code: "invalid_note",
    });
    expect(
      await reportFailure(db, USER, "SB-0123ABCD", "x".repeat(1001)),
    ).toMatchObject({ ok: false, code: "invalid_note" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the signed-in user and the trimmed note to the database function", async () => {
    const { db, rpc } = fakeDb({ error: null });
    rpc.mockResolvedValue({ data: true, error: null });
    expect(
      await reportFailure(db, USER, "SB-0123ABCD", "  it broke  "),
    ).toEqual({
      ok: true,
    });
    expect(rpc).toHaveBeenCalledWith("report_failure", {
      p_reference: "SB-0123ABCD",
      p_user_id: USER,
      p_note: "it broke",
    });
  });

  it("says so when the failure isn't the user's, and when sending fails", async () => {
    const { db, rpc } = fakeDb({ error: null });
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await reportFailure(db, USER, "SB-0123ABCD", "hi")).toMatchObject({
      ok: false,
      code: "not_found",
    });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "db down" } });
    const r = await reportFailure(db, USER, "SB-0123ABCD", "hi");
    expect(r).toMatchObject({ ok: false, code: "error" });
    expect(JSON.stringify(r)).not.toMatch(/db down/);
  });
});
