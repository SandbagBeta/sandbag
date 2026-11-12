import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRetryScan } from "./retry";

const USER = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b1";
const SCAN = "20000000-0000-4000-8000-0000000000a1";
const NEW = "20000000-0000-4000-8000-0000000000c1";

/** Chainable query stub: every builder method returns itself; awaiting resolves. */
function table(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: result, error: null });
  q.then = (r: (v: unknown) => unknown) => r({ data: result, error: null });
  return q;
}

function userClient(opts: {
  scan: object | null;
  reviews?: object[];
  existing?: object[];
}) {
  let scanCalls = 0;
  return {
    from: (t: string) => {
      if (t === "reviews") return table(opts.reviews ?? []);
      scanCalls++;
      return scanCalls === 1 ? table(opts.scan) : table(opts.existing ?? []);
    },
  } as unknown as SupabaseClient;
}

function serviceClient(inserts: unknown[]) {
  return {
    from: () => ({
      insert: (row: unknown) => {
        inserts.push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: NEW }, error: null }),
          }),
        };
      },
    }),
  } as unknown as SupabaseClient;
}

const failed = {
  id: SCAN,
  uploader_id: USER,
  status: "failed_qc",
  openbeta_area_id: null,
  openbeta_climb_id: null,
};

describe("createRetryScan", () => {
  it("links the new scan via retry_of, owned by the session user, no status", async () => {
    const inserts: Record<string, unknown>[] = [];
    const r = await createRetryScan(
      userClient({ scan: failed }),
      serviceClient(inserts),
      USER,
      SCAN,
    );
    expect(r).toEqual({ ok: true, scanId: NEW });
    expect(inserts[0]).toMatchObject({ uploader_id: USER, retry_of: SCAN });
    expect(inserts[0]).not.toHaveProperty("status");
  });

  it("refuses someone else's scan", async () => {
    const inserts: unknown[] = [];
    const r = await createRetryScan(
      userClient({ scan: { ...failed, uploader_id: OTHER } }),
      serviceClient(inserts),
      USER,
      SCAN,
    );
    expect(r.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("refuses a scan that is not retryable", async () => {
    const inserts: unknown[] = [];
    const r = await createRetryScan(
      userClient({ scan: { ...failed, status: "published" } }),
      serviceClient(inserts),
      USER,
      SCAN,
    );
    expect(r.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("reuses an unfinished retry instead of creating another", async () => {
    const inserts: unknown[] = [];
    const r = await createRetryScan(
      userClient({ scan: failed, existing: [{ id: NEW, status: "uploaded" }] }),
      serviceClient(inserts),
      USER,
      SCAN,
    );
    expect(r).toEqual({ ok: true, scanId: NEW });
    expect(inserts).toHaveLength(0);
  });

  it("refuses when a retry already went through QC", async () => {
    const r = await createRetryScan(
      userClient({
        scan: failed,
        existing: [{ id: NEW, status: "failed_qc" }],
      }),
      serviceClient([]),
      USER,
      SCAN,
    );
    expect(r.ok).toBe(false);
  });
});
