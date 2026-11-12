import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadNotifications, verdictMessage } from "./notifications";

describe("verdictMessage", () => {
  it("names the climb when known and says what happened", () => {
    expect(verdictMessage("approve", "climb", "Crimpy")).toBe(
      'Your climb "Crimpy" was approved and is now published.',
    );
    expect(verdictMessage("request_changes", "scan", null)).toContain(
      "needs changes",
    );
    expect(verdictMessage("reject", "scan", null)).toBe(
      "Your scan was rejected.",
    );
  });
});

function fakeDb(rows: unknown[], climbs: unknown[]) {
  return {
    from(table: string) {
      const result = { data: table === "climbs" ? climbs : rows, error: null };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "in"]) q[m] = () => q;
      q.returns = () => q;
      q.then = (res: (v: unknown) => unknown) => res(result);
      return q;
    },
  } as unknown as SupabaseClient;
}

describe("loadNotifications", () => {
  it("joins verdict, reason and climb name; flags unread", async () => {
    const db = fakeDb(
      [
        {
          id: "n1",
          created_at: "2026-11-12T00:00:00Z",
          read_at: null,
          reviews: {
            verdict: "reject",
            reason: "Blurry",
            subject_type: "climb",
            subject_id: "c1",
          },
        },
        { id: "n2", created_at: "x", read_at: "y", reviews: null },
      ],
      [{ id: "c1", name: "Crimpy" }],
    );
    const out = await loadNotifications(db);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      unread: true,
      reason: "Blurry",
      subjectName: "Crimpy",
    });
    expect(out[0]?.message).toContain("rejected");
  });

  const review = (verdict: string, subject_type = "climb") => ({
    id: "n1",
    created_at: "x",
    read_at: null,
    reviews: {
      verdict,
      reason: "Move the start",
      subject_type,
      subject_id: "c1",
    },
  });

  it("links request-changes on a pending climb to its edit page", async () => {
    const db = fakeDb(
      [review("request_changes")],
      [{ id: "c1", name: "Crimpy", scan_id: "s1", status: "pending_review" }],
    );
    expect((await loadNotifications(db))[0]?.editHref).toBe(
      "/boulder/s1/annotate?climb=c1",
    );
  });

  it.each([
    ["approve", "published"],
    ["reject", "rejected"],
    ["request_changes", "published"],
  ])("offers no edit link for %s on a %s climb", async (verdict, status) => {
    const db = fakeDb(
      [review(verdict)],
      [{ id: "c1", name: "Crimpy", scan_id: "s1", status }],
    );
    expect((await loadNotifications(db))[0]?.editHref).toBeNull();
  });
});
