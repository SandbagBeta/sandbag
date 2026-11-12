import { describe, expect, it } from "vitest";
import { createFakeDb } from "./fake-db";
import { ReviewNotAllowedError, SubjectNotFoundError } from "./review";
import { setScanScale } from "./scale";
import { TransitionConflictError } from "./errors";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "e")}`;
const MAINT = id(1);
const REVIEWER = id(2);
const UPLOADER = id(3);
const SCAN = id(10);

function seed(scan: object = {}) {
  return createFakeDb({
    profiles: [
      { id: MAINT, trust_level: "maintainer" },
      { id: REVIEWER, trust_level: "reviewer" },
      { id: UPLOADER, trust_level: "contributor" },
    ],
    scans: [
      {
        id: SCAN,
        status: "pending_review",
        uploader_id: UPLOADER,
        scale_factor: 1,
        content_hash: "h",
        ...scan,
      },
    ],
  });
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => (e instanceof ReviewNotAllowedError ? e.code : e),
  );

describe("setScanScale", () => {
  it("lets a maintainer set the factor on a pending scan, touching nothing else", async () => {
    const f = seed();
    const r = await setScanScale(f.client, {
      maintainerId: MAINT,
      scanId: SCAN,
      factor: 13.3,
    });
    expect(r).toMatchObject({ scale_factor: 13.3, scale_set_by: MAINT });
    expect(f.row("scans")).toMatchObject({
      status: "pending_review",
      content_hash: "h",
      scale_factor: 13.3,
      scale_set_by: MAINT,
    });
    expect(f.row("scans").scale_set_at).toEqual(r.scale_set_at);
  });

  it.each([0, -1, 0.0001, 1001, NaN, Infinity, "2" as unknown as number])(
    "refuses factor %s",
    async (factor) => {
      const f = seed();
      expect(
        await code(
          setScanScale(f.client, { maintainerId: MAINT, scanId: SCAN, factor }),
        ),
      ).toBe("invalid_scale");
      expect(f.row("scans").scale_factor).toBe(1);
    },
  );

  it("refuses reviewers and contributors", async () => {
    for (const who of [REVIEWER, UPLOADER, id(99)]) {
      expect(
        await code(
          setScanScale(seed().client, {
            maintainerId: who,
            scanId: SCAN,
            factor: 2,
          }),
        ),
      ).toBe("not_maintainer");
    }
  });

  it("refuses a maintainer's own scan", async () => {
    const f = seed({ uploader_id: MAINT });
    expect(
      await code(
        setScanScale(f.client, {
          maintainerId: MAINT,
          scanId: SCAN,
          factor: 2,
        }),
      ),
    ).toBe("self_review");
  });

  it.each(["uploaded", "processing", "failed_qc", "published", "rejected"])(
    "refuses a %s scan",
    async (status) => {
      const f = seed({ status });
      expect(
        await code(
          setScanScale(f.client, {
            maintainerId: MAINT,
            scanId: SCAN,
            factor: 2,
          }),
        ),
      ).toBe("not_pending");
      expect(f.row("scans").scale_factor).toBe(1);
    },
  );

  it("reports a missing scan and a bad id", async () => {
    const f = seed();
    await expect(
      setScanScale(f.client, {
        maintainerId: MAINT,
        scanId: id(77),
        factor: 2,
      }),
    ).rejects.toBeInstanceOf(SubjectNotFoundError);
    await expect(
      setScanScale(f.client, {
        maintainerId: MAINT,
        scanId: "nope",
        factor: 2,
      }),
    ).rejects.toBeInstanceOf(SubjectNotFoundError);
  });

  it("loses a race with a status change instead of writing", async () => {
    const f = seed();
    f.beforeNext("scans", "update", () => {
      f.row("scans").status = "published";
    });
    await expect(
      setScanScale(f.client, { maintainerId: MAINT, scanId: SCAN, factor: 2 }),
    ).rejects.toBeInstanceOf(TransitionConflictError);
    expect(f.row("scans").scale_factor).toBe(1);
  });
});
