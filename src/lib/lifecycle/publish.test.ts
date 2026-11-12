import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFakeDb } from "./fake-db";
import { createFakeStorage } from "./fake-storage";
import { submitReview, type ReviewInput } from "./review";

// Publishing the mesh on approval (issue #116, ADR 002 §3).

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "f")}`;
const REVIEWER = id(1);
const AUTHOR = id(3);
const SCAN = id(10);

const GLB = new TextEncoder().encode("canonical-glb-bytes");
const THUMB = new TextEncoder().encode("thumb-bytes");
const HASH = createHash("sha256").update(GLB).digest("hex");
const DERIVED = `${AUTHOR}/${SCAN}/derived/${HASH}.glb`;
const DERIVED_THUMB = `${AUTHOR}/${SCAN}/derived/thumb.webp`;
const PUBLISHED = `${SCAN}/${HASH}.glb`;
const PUBLISHED_THUMB = `${SCAN}/${HASH}.webp`;

function seed(scan: object = {}) {
  return createFakeDb({
    profiles: [
      { id: REVIEWER, trust_level: "reviewer" },
      { id: AUTHOR, trust_level: "contributor" },
    ],
    scans: [
      {
        id: SCAN,
        status: "pending_review",
        uploader_id: AUTHOR,
        glb_path: DERIVED,
        content_hash: HASH,
        ...scan,
      },
    ],
    climbs: [],
    area_cache: [],
    reviews: [],
  });
}

const stored = () =>
  createFakeStorage({
    [`uploads/${DERIVED}`]: GLB,
    [`uploads/${DERIVED_THUMB}`]: THUMB,
  });

const approve = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  reviewerId: REVIEWER,
  subjectType: "scan",
  subjectId: SCAN,
  verdict: "approve",
  ...over,
});

const publishedKeys = (fs: ReturnType<typeof stored>) =>
  [...fs.objects.keys()].filter((k) => k.startsWith("published/"));

describe("submitReview publishes the mesh (#116)", () => {
  it("copies the GLB and thumbnail, points glb_path at the public key, then deletes the derived copies", async () => {
    const db = seed();
    const fs = stored();
    const res = await submitReview(db.client, approve(), {
      storage: fs.adapter,
    });
    expect(res.status).toBe("published");
    expect(db.row("scans")).toMatchObject({
      status: "published",
      glb_path: PUBLISHED,
      content_hash: HASH,
    });
    expect(fs.objects.get(`published/${PUBLISHED}`)).toEqual(GLB);
    expect(fs.objects.get(`published/${PUBLISHED_THUMB}`)).toEqual(THUMB);
    // The public key carries no uploader id.
    expect(PUBLISHED).not.toContain(AUTHOR);
    // The private derived copies are removed once the scan is published.
    expect(fs.has("uploads", DERIVED)).toBe(false);
    expect(fs.has("uploads", DERIVED_THUMB)).toBe(false);
  });

  it("publishes without a thumbnail when none exists", async () => {
    const db = seed();
    const fs = createFakeStorage({ [`uploads/${DERIVED}`]: GLB });
    const res = await submitReview(db.client, approve(), {
      storage: fs.adapter,
    });
    expect(res.status).toBe("published");
    expect(fs.has("published", PUBLISHED_THUMB)).toBe(false);
  });

  it("a failing thumbnail upload does not block the publish", async () => {
    const db = seed();
    const fs = stored();
    // First put is the GLB; make only the second (thumbnail) fail.
    let puts = 0;
    const put = fs.adapter.put;
    fs.adapter.put = async (ref, bytes, opts) => {
      if (++puts === 2) throw new Error("boom");
      return put(ref, bytes, opts);
    };
    const res = await submitReview(db.client, approve(), {
      storage: fs.adapter,
    });
    expect(res.status).toBe("published");
    expect(fs.has("published", PUBLISHED)).toBe(true);
    expect(fs.has("published", PUBLISHED_THUMB)).toBe(false);
  });

  it("copies before it writes the status", async () => {
    const db = seed();
    const fs = stored();
    let copiedFirst = false;
    db.beforeNext("scans", "update", () => {
      copiedFirst = fs.has("published", PUBLISHED);
    });
    await submitReview(db.client, approve(), { storage: fs.adapter });
    expect(copiedFirst).toBe(true);
  });

  it("leaves the scan pending and removes the review row when the copy fails", async () => {
    const db = seed();
    const fs = stored();
    fs.failNext("put");
    await expect(
      submitReview(db.client, approve(), { storage: fs.adapter }),
    ).rejects.toThrow(/copying to published failed/);
    expect(db.row("scans")).toMatchObject({
      status: "pending_review",
      glb_path: DERIVED,
    });
    expect(db.tables.reviews).toHaveLength(0);
  });

  it("refuses bytes that don't match content_hash, publishing nothing", async () => {
    const db = seed();
    const fs = createFakeStorage({
      [`uploads/${DERIVED}`]: new TextEncoder().encode("tampered"),
    });
    await expect(
      submitReview(db.client, approve(), { storage: fs.adapter }),
    ).rejects.toThrow(/content hash/);
    expect(publishedKeys(fs)).toEqual([]);
    expect(db.row("scans").status).toBe("pending_review");
    expect(db.tables.reviews).toHaveLength(0);
  });

  it.each([
    ["another scan's key", `${AUTHOR}/${id(99)}/derived/${HASH}.glb`],
    ["a raw upload", `${AUTHOR}/${SCAN}/raw/source.glb`],
    ["the right name in the raw folder", `${AUTHOR}/${SCAN}/raw/${HASH}.glb`],
    ["a path with extra segments", `x/${DERIVED}`],
    ["a path traversal", `${AUTHOR}/${SCAN}/derived/../raw/${HASH}.glb`],
    ["a wrong hash", `${AUTHOR}/${SCAN}/derived/${"c".repeat(64)}.glb`],
    ["a non-uuid owner", `someone/${SCAN}/derived/${HASH}.glb`],
  ])("never publishes %s", async (_label, glbPath) => {
    const db = seed({ glb_path: glbPath });
    const fs = createFakeStorage({ [`uploads/${glbPath}`]: GLB });
    await expect(
      submitReview(db.client, approve(), { storage: fs.adapter }),
    ).rejects.toThrow(/won't be published/);
    expect(publishedKeys(fs)).toEqual([]);
    expect(db.row("scans").status).toBe("pending_review");
    expect(db.tables.reviews).toHaveLength(0);
  });

  it("accepts a scan whose glb_path already is its published key, without copying", async () => {
    const db = seed({ glb_path: PUBLISHED });
    const fs = createFakeStorage({ [`published/${PUBLISHED}`]: GLB });
    const res = await submitReview(db.client, approve(), {
      storage: fs.adapter,
    });
    expect(res.status).toBe("published");
    expect(fs.log.some((l) => l.startsWith("download"))).toBe(false);
  });

  it("refuses a published glb_path whose object is missing", async () => {
    const db = seed({ glb_path: PUBLISHED });
    await expect(
      submitReview(db.client, approve(), {
        storage: createFakeStorage().adapter,
      }),
    ).rejects.toThrow(/missing published object/);
    expect(db.tables.reviews).toHaveLength(0);
  });

  it("does not touch storage for rejections or requested changes", async () => {
    for (const verdict of ["reject", "request_changes"] as const) {
      const db = seed();
      const fs = stored();
      await submitReview(db.client, approve({ verdict, reason: "no" }), {
        storage: fs.adapter,
      });
      expect(fs.log).toEqual([]);
    }
  });
});
