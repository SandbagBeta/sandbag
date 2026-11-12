import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  editDenial,
  editDeniedHelp,
  editPath,
  loadEditableClimb,
  loadMyPendingClimbs,
  type EditDenial,
} from "./editClimb";

const SCAN = "00000000-0000-4000-8000-0000000000a1";
const CLIMB = "00000000-0000-4000-8000-0000000000c1";
const ME = "00000000-0000-4000-8000-0000000000b1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";

const climb = (over: object = {}) => ({
  id: CLIMB,
  scan_id: SCAN,
  name: "Line",
  description: "",
  proposed_grade: "V3",
  fa_info: null,
  status: "pending_review",
  created_by: ME,
  ...over,
});

/** A supabase-js stand-in: every chain method returns itself; awaiting gives the table's result. */
function fakeDb(
  tables: Record<string, { data?: unknown; error?: { message: string } }>,
) {
  const asked: string[] = [];
  const db = {
    from(table: string) {
      asked.push(table);
      const result = { data: null, error: null, ...tables[table] };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order"]) q[m] = () => q;
      q.maybeSingle = async () => result;
      q.then = (res: (v: unknown) => unknown) => res(result);
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, asked };
}

describe("editDenial", () => {
  const c = (over: object = {}) => climb(over) as never;
  it("lets the author edit their pending climb", () => {
    expect(editDenial(c(), SCAN, ME)).toBeNull();
  });
  it.each<[string, unknown, string, string, EditDenial]>([
    ["no such climb", null, SCAN, ME, "not_found"],
    ["a climb of another scan", climb({ scan_id: "x" }), SCAN, ME, "not_found"],
    ["someone else's climb", climb(), SCAN, OTHER, "not_author"],
    [
      "an anonymised climb",
      climb({ created_by: null }),
      SCAN,
      ME,
      "not_author",
    ],
    [
      "a published climb",
      climb({ status: "published" }),
      SCAN,
      ME,
      "not_pending",
    ],
    [
      "a rejected climb",
      climb({ status: "rejected" }),
      SCAN,
      ME,
      "not_pending",
    ],
  ])("refuses %s", (_n, row, scan, user, want) => {
    expect(editDenial(row as never, scan, user)).toBe(want);
  });
});

describe("editDeniedHelp", () => {
  it.each<EditDenial>(["not_found", "not_author", "not_pending"])(
    "%s says what happened, the step, what to do and next steps",
    (reason) => {
      const h = editDeniedHelp(reason);
      expect(h.whatHappened).toMatch(/^You can't edit this climb/);
      expect(h.stage).toBe("access");
      expect(h.stageLabel).toBeTruthy();
      expect(h.whatYouCanDo.length).toBeGreaterThan(0);
      expect(h.nextSteps.length).toBeGreaterThan(0);
      expect(h.reference).toBeUndefined();
    },
  );
});

describe("loadEditableClimb", () => {
  it("returns the climb with its holds and paths for the author", async () => {
    const { db } = fakeDb({
      climbs: { data: climb() },
      holds: { data: [{ id: "h1" }] },
      paths: { data: [{ id: "p1" }] },
    });
    const r = await loadEditableClimb(db, SCAN, CLIMB, ME);
    expect(r).toMatchObject({
      ok: true,
      holds: [{ id: "h1" }],
      paths: [{ id: "p1" }],
    });
  });

  it("does not read holds for someone who may not edit", async () => {
    const { db, asked } = fakeDb({ climbs: { data: climb() } });
    const r = await loadEditableClimb(db, SCAN, CLIMB, OTHER);
    expect(r).toMatchObject({
      ok: false,
      help: {
        whatHappened: expect.stringContaining("only the person who created"),
      },
    });
    expect(asked).toEqual(["climbs"]);
  });

  it("refuses a published climb and an unknown or malformed id", async () => {
    const pub = fakeDb({ climbs: { data: climb({ status: "published" }) } });
    expect(await loadEditableClimb(pub.db, SCAN, CLIMB, ME)).toMatchObject({
      ok: false,
      help: {
        whatHappened: expect.stringContaining("isn't waiting for review"),
      },
    });
    const none = fakeDb({ climbs: { data: null } });
    expect(await loadEditableClimb(none.db, SCAN, CLIMB, ME)).toMatchObject({
      ok: false,
    });
    expect(await loadEditableClimb(none.db, SCAN, "nope", ME)).toMatchObject({
      ok: false,
    });
    expect(none.asked).toEqual(["climbs"]);
  });

  it("throws on a database error instead of pretending it is a denial", async () => {
    const { db } = fakeDb({ climbs: { error: { message: "boom" } } });
    await expect(loadEditableClimb(db, SCAN, CLIMB, ME)).rejects.toThrow(
      /boom/,
    );
  });
});

describe("loadMyPendingClimbs", () => {
  it("links each climb to its edit page", async () => {
    const { db } = fakeDb({
      climbs: { data: [{ id: CLIMB, name: "Line", scan_id: SCAN }] },
    });
    expect(await loadMyPendingClimbs(db, ME)).toEqual([
      { id: CLIMB, name: "Line", href: editPath(SCAN, CLIMB) },
    ]);
    expect(editPath(SCAN, CLIMB)).toBe(
      `/boulder/${SCAN}/annotate?climb=${CLIMB}`,
    );
  });
});
