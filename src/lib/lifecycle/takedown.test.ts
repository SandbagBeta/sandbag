import { describe, expect, it } from "vitest";
import { createFakeDb } from "./fake-db";
import { SubjectNotFoundError, submitReview } from "./review";
import { takeDown, type TakedownInput } from "./takedown";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "e")}`;
const MAINTAINER = id(1);
const REVIEWER = id(2);
const CONTRIBUTOR = id(3);
const SCAN = id(10);
const CLIMB = id(11);
const AREA = id(12);

function seed(over: { scan?: object; climb?: object } = {}) {
  return createFakeDb({
    profiles: [
      { id: MAINTAINER, trust_level: "maintainer" },
      { id: REVIEWER, trust_level: "reviewer" },
      { id: CONTRIBUTOR, trust_level: "contributor" },
    ],
    scans: [
      {
        id: SCAN,
        status: "published",
        uploader_id: CONTRIBUTOR,
        glb_path: "published/s.glb",
        content_hash: "c".repeat(64),
        ...over.scan,
      },
    ],
    climbs: [
      {
        id: CLIMB,
        scan_id: SCAN,
        status: "published",
        created_by: CONTRIBUTOR,
        ...over.climb,
      },
    ],
    area_cache: [{ openbeta_area_id: AREA, ancestors_changed_at: null }],
    reviews: [],
  });
}

const input = (over: Partial<TakedownInput> = {}): TakedownInput => ({
  maintainerId: MAINTAINER,
  subjectType: "scan",
  subjectId: SCAN,
  reason: "Access-sensitive: landowner asked us to remove it",
  ...over,
});

describe("takeDown", () => {
  it.each([
    ["scan", SCAN, "scans"],
    ["climb", CLIMB, "climbs"],
  ] as const)(
    "a maintainer takes down a published %s; review row first, then CAS",
    async (t, sid, table) => {
      const db = seed();
      const res = await takeDown(
        db.client,
        input({ subjectType: t, subjectId: sid, reason: "  unsafe access  " }),
      );
      expect(res.status).toBe("rejected");
      expect(db.row(table).status).toBe("rejected");
      expect(db.row("reviews")).toMatchObject({
        subject_type: t,
        subject_id: sid,
        reviewer_id: MAINTAINER,
        verdict: "reject",
        reason: "unsafe access",
      });
      const writes = db.log.filter((l) => l.op !== "select");
      expect(writes.map((l) => l.table)).toEqual(["reviews", table]);
      expect(writes[1]).toMatchObject({
        values: { status: "rejected" },
        filters: [
          ["id", sid],
          ["status", "published"],
        ],
      });
    },
  );

  it("leaves the scan's climbs alone (RLS hides them with the scan)", async () => {
    const db = seed();
    await takeDown(db.client, input());
    expect(db.row("climbs").status).toBe("published");
    expect(db.log.some((l) => l.table === "climbs" && l.op !== "select")).toBe(
      false,
    );
  });

  it.each([
    ["reviewer (not maintainer)", REVIEWER],
    ["contributor", CONTRIBUTOR],
    ["unknown user", id(99)],
  ])("refuses a %s", async (_label, maintainerId) => {
    const db = seed();
    await expect(
      takeDown(db.client, input({ maintainerId })),
    ).rejects.toMatchObject({ code: "not_maintainer" });
    expect(db.tables.reviews).toHaveLength(0);
    expect(db.row("scans").status).toBe("published");
  });

  it("refuses a missing or blank reason before any DB call", async () => {
    for (const reason of [undefined, null, "", "   \n"]) {
      const db = seed();
      await expect(
        takeDown(db.client, input({ reason: reason as unknown as string })),
      ).rejects.toMatchObject({ code: "reason_required" });
      expect(db.log).toEqual([]);
    }
  });

  it.each([
    "uploaded",
    "processing",
    "failed_qc",
    "pending_review",
    "rejected",
  ])("refuses a scan that is %s", async (status) => {
    const db = seed({ scan: { status } });
    await expect(takeDown(db.client, input())).rejects.toMatchObject({
      code: "not_published",
    });
    expect(db.row("scans").status).toBe(status);
    expect(db.tables.reviews).toHaveLength(0);
  });

  it.each([
    ["scan", id(404)],
    ["climb", id(404)],
    ["climb", SCAN], // a scan id is not a climb
    ["scan", "1; drop"],
  ] as const)("refuses a nonexistent %s %s", async (t, sid) => {
    const db = seed();
    await expect(
      takeDown(db.client, input({ subjectType: t, subjectId: sid })),
    ).rejects.toThrow(SubjectNotFoundError);
    expect(db.tables.reviews).toHaveLength(0);
  });

  it("refuses an area (areas have no status)", async () => {
    const db = seed();
    await expect(
      takeDown(
        db.client,
        input({
          subjectType: "area" as unknown as "scan",
          subjectId: AREA,
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(db.log).toEqual([]);
  });

  it("on a CAS conflict removes its review row and keeps the racer's state", async () => {
    const db = seed();
    db.beforeNext("scans", "update", () => {
      db.row("scans").status = "rejected";
    });
    await expect(takeDown(db.client, input())).rejects.toThrow(/Conflict/);
    expect(db.tables.reviews).toHaveLength(0);
    expect(db.row("scans").status).toBe("rejected");
  });

  it("keeps the review row when the status write has an unknown outcome", async () => {
    const db = seed();
    db.failNext("scans", "update", "timeout");
    await expect(takeDown(db.client, input())).rejects.toThrow(/timeout/);
    expect(db.tables.reviews).toHaveLength(1);
  });

  it("names the orphaned review if the undo itself fails", async () => {
    const db = seed();
    db.beforeNext("scans", "update", () => {
      db.row("scans").status = "rejected";
    });
    db.failNext("reviews", "delete", "gone away");
    await expect(takeDown(db.client, input())).rejects.toThrow(
      /Also failed to remove review .*gone away/,
    );
  });

  it("submitReview still cannot touch a published item, even for a maintainer", async () => {
    const db = seed();
    await expect(
      submitReview(db.client, {
        reviewerId: MAINTAINER,
        subjectType: "scan",
        subjectId: SCAN,
        verdict: "reject",
        reason: "take it down",
      }),
    ).rejects.toMatchObject({ code: "not_pending" });
    expect(db.row("scans").status).toBe("published");
    expect(db.tables.reviews).toHaveLength(0);
  });
});
