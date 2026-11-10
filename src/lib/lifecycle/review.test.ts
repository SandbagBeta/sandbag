import { describe, expect, it } from "vitest";
import { MissingMeshError } from "./apply";
import { createFakeDb } from "./fake-db";
import {
  AreaFlagConflictError,
  ReviewNotAllowedError,
  SubjectNotFoundError,
  submitReview,
  type ReviewInput,
} from "./review";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "f")}`;
const REVIEWER = id(1);
const CONTRIBUTOR = id(2);
const AUTHOR = id(3);
const SCAN = id(10);
const CLIMB = id(11);
const AREA = id(12);
const FLAGGED_AT = "2026-11-01T00:00:00+00:00";

function seed(
  overrides: { scan?: object; climb?: object; area?: object } = {},
) {
  return createFakeDb({
    profiles: [
      { id: REVIEWER, trust_level: "reviewer" },
      { id: CONTRIBUTOR, trust_level: "contributor" },
      { id: AUTHOR, trust_level: "maintainer" },
    ],
    scans: [
      {
        id: SCAN,
        status: "pending_review",
        uploader_id: AUTHOR,
        glb_path: "published/s.glb",
        content_hash: "b".repeat(64),
        ...overrides.scan,
      },
    ],
    climbs: [
      {
        id: CLIMB,
        status: "pending_review",
        created_by: AUTHOR,
        ...overrides.climb,
      },
    ],
    area_cache: [
      {
        openbeta_area_id: AREA,
        ancestors_changed_at: FLAGGED_AT,
        ...overrides.area,
      },
    ],
    reviews: [],
  });
}

const review = (over: Partial<ReviewInput>): ReviewInput => ({
  reviewerId: REVIEWER,
  subjectType: "scan",
  subjectId: SCAN,
  verdict: "approve",
  ...over,
});

describe("submitReview: scans and climbs", () => {
  it.each([
    ["scan", SCAN, "scans"],
    ["climb", CLIMB, "climbs"],
  ] as const)(
    "approve publishes a %s, review row written first",
    async (t, sid, table) => {
      const db = seed();
      const res = await submitReview(
        db.client,
        review({ subjectType: t, subjectId: sid }),
      );
      expect(res.status).toBe("published");
      expect(db.row(table).status).toBe("published");
      expect(db.tables.reviews).toHaveLength(1);
      const writes = db.log
        .filter((l) => l.op !== "select")
        .map((l) => l.table);
      expect(writes).toEqual(["reviews", table]);
    },
  );

  it("reject moves to rejected and stores the trimmed reason", async () => {
    const db = seed();
    const res = await submitReview(
      db.client,
      review({
        subjectType: "climb",
        subjectId: CLIMB,
        verdict: "reject",
        reason: "  dupe  ",
      }),
    );
    expect(res.status).toBe("rejected");
    expect(db.row("climbs").status).toBe("rejected");
    expect(db.row("reviews")).toMatchObject({
      verdict: "reject",
      reason: "dupe",
    });
  });

  it("request_changes records the review and leaves the item pending_review", async () => {
    const db = seed();
    const res = await submitReview(
      db.client,
      review({
        verdict: "request_changes",
        reason: "coverage gap on the north face",
      }),
    );
    expect(res.status).toBe("pending_review");
    expect(db.row("scans").status).toBe("pending_review");
    expect(db.tables.reviews).toHaveLength(1);
    expect(db.log.some((l) => l.table === "scans" && l.op === "update")).toBe(
      false,
    );
  });

  it.each(["reject", "request_changes"] as const)(
    "%s without a reason is refused before any write",
    async (verdict) => {
      for (const reason of [undefined, null, "", "   "]) {
        const db = seed();
        await expect(
          submitReview(db.client, review({ verdict, reason })),
        ).rejects.toMatchObject({
          code: "reason_required",
        });
        expect(db.log).toEqual([]);
      }
    },
  );

  it.each([
    ["contributor", CONTRIBUTOR],
    ["unknown user", id(99)],
  ])("refuses a %s as reviewer", async (_label, reviewerId) => {
    const db = seed();
    await expect(
      submitReview(db.client, review({ reviewerId })),
    ).rejects.toMatchObject({
      code: "not_reviewer",
    });
    expect(db.tables.reviews).toHaveLength(0);
    expect(db.row("scans").status).toBe("pending_review");
  });

  it.each([
    ["scan", SCAN],
    ["climb", CLIMB],
  ] as const)(
    "refuses self-review of a %s, even by a maintainer",
    async (t, sid) => {
      const db = seed();
      await expect(
        submitReview(
          db.client,
          review({ reviewerId: AUTHOR, subjectType: t, subjectId: sid }),
        ),
      ).rejects.toMatchObject({ code: "self_review" });
      expect(db.tables.reviews).toHaveLength(0);
    },
  );

  it.each(["scan", "climb", "area"] as const)(
    "refuses a nonexistent %s",
    async (t) => {
      const db = seed();
      await expect(
        submitReview(db.client, review({ subjectType: t, subjectId: id(404) })),
      ).rejects.toThrow(SubjectNotFoundError);
      // A scan id is not a climb: the subject type picks the table.
      await expect(
        submitReview(
          db.client,
          review({
            subjectType: t === "scan" ? "climb" : "scan",
            subjectId: t === "scan" ? SCAN : CLIMB,
          }),
        ),
      ).rejects.toThrow(SubjectNotFoundError);
      expect(db.tables.reviews).toHaveLength(0);
    },
  );

  it("treats a non-uuid subject id as not found without querying", async () => {
    const db = seed();
    await expect(
      submitReview(db.client, review({ subjectId: "1; drop" })),
    ).rejects.toThrow(SubjectNotFoundError);
    expect(db.log).toEqual([]);
  });

  it.each(["published", "rejected", "processing", "failed_qc", "uploaded"])(
    "refuses to review a scan that is %s",
    async (status) => {
      const db = seed({ scan: { status } });
      await expect(submitReview(db.client, review({}))).rejects.toMatchObject({
        code: "not_pending",
      });
      expect(db.row("scans").status).toBe(status);
      expect(db.tables.reviews).toHaveLength(0);
    },
  );

  it("refuses to approve a scan without a mesh, before writing the review", async () => {
    const db = seed({ scan: { glb_path: null, content_hash: null } });
    await expect(submitReview(db.client, review({}))).rejects.toThrow(
      MissingMeshError,
    );
    expect(db.tables.reviews).toHaveLength(0);
  });

  it("on a CAS conflict, removes its review row and leaves the racer's state", async () => {
    const db = seed();
    db.beforeNext("scans", "update", () => {
      db.row("scans").status = "rejected";
    });
    await expect(submitReview(db.client, review({}))).rejects.toThrow(
      /Conflict/,
    );
    expect(db.row("scans").status).toBe("rejected");
    expect(db.tables.reviews).toHaveLength(0);
  });

  it("keeps the review row when the status write fails with an unknown outcome", async () => {
    const db = seed();
    db.failNext("scans", "update", "timeout");
    await expect(submitReview(db.client, review({}))).rejects.toThrow(
      /timeout/,
    );
    expect(db.tables.reviews).toHaveLength(1);
  });

  it("never changes status when the review insert fails", async () => {
    const db = seed();
    db.failNext("reviews", "insert");
    await expect(submitReview(db.client, review({}))).rejects.toThrow(
      /writing review/,
    );
    expect(db.row("scans").status).toBe("pending_review");
  });

  it("uses typed errors", async () => {
    const db = seed();
    await expect(
      submitReview(db.client, review({ reviewerId: CONTRIBUTOR })),
    ).rejects.toThrow(ReviewNotAllowedError);
  });
});

describe("submitReview: areas (ADR 001 P3)", () => {
  it("approve clears ancestors_changed_at, after writing the review", async () => {
    const db = seed();
    const res = await submitReview(
      db.client,
      review({ subjectType: "area", subjectId: AREA }),
    );
    expect(res.areaFlagCleared).toBe(true);
    expect(db.row("area_cache").ancestors_changed_at).toBeNull();
    const writes = db.log.filter((l) => l.op !== "select").map((l) => l.table);
    expect(writes).toEqual(["reviews", "area_cache"]);
  });

  it.each(["reject", "request_changes"] as const)(
    "%s records the review and leaves the flag set",
    async (verdict) => {
      const db = seed();
      const res = await submitReview(
        db.client,
        review({
          subjectType: "area",
          subjectId: AREA,
          verdict,
          reason: "still moving",
        }),
      );
      expect(res.areaFlagCleared).toBe(false);
      expect(db.row("area_cache").ancestors_changed_at).toBe(FLAGGED_AT);
      expect(db.tables.reviews).toHaveLength(1);
    },
  );

  it("does not clear a flag that a refresh re-set mid-review", async () => {
    const db = seed();
    db.beforeNext("area_cache", "update", () => {
      db.row("area_cache").ancestors_changed_at = "2026-11-10T09:00:00+00:00";
    });
    await expect(
      submitReview(db.client, review({ subjectType: "area", subjectId: AREA })),
    ).rejects.toThrow(AreaFlagConflictError);
    expect(db.row("area_cache").ancestors_changed_at).not.toBeNull();
    expect(db.tables.reviews).toHaveLength(0);
  });

  it("approving an unflagged area records the review and changes nothing", async () => {
    const db = seed({ area: { ancestors_changed_at: null } });
    const res = await submitReview(
      db.client,
      review({ subjectType: "area", subjectId: AREA }),
    );
    expect(res.areaFlagCleared).toBe(false);
    expect(
      db.log.some((l) => l.table === "area_cache" && l.op === "update"),
    ).toBe(false);
  });

  it("still requires reviewer trust for areas", async () => {
    const db = seed();
    await expect(
      submitReview(
        db.client,
        review({
          reviewerId: CONTRIBUTOR,
          subjectType: "area",
          subjectId: AREA,
        }),
      ),
    ).rejects.toMatchObject({ code: "not_reviewer" });
    expect(db.row("area_cache").ancestors_changed_at).toBe(FLAGGED_AT);
  });
});
