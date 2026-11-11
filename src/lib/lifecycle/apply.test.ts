import { describe, expect, it } from "vitest";
import type { QcReport } from "../types";
import {
  applyTransition,
  InvalidPatchError,
  LifecycleDbError,
  MissingMeshError,
  TransitionConflictError,
  type ScanQcPatch,
  type TransitionRequest,
} from "./apply";
import { createFakeDb } from "./fake-db";
import { InvalidTransitionError } from "./transitions";

const SCAN = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);

function scanDb(status: string, mesh = true) {
  return createFakeDb({
    scans: [
      {
        id: SCAN,
        status,
        glb_path: mesh ? "published/x.glb" : null,
        content_hash: mesh ? HASH : null,
      },
    ],
  });
}

describe("applyTransition", () => {
  it("compare-and-sets status on the row", async () => {
    const db = scanDb("uploaded");
    await applyTransition(db.client, {
      kind: "scan",
      id: SCAN,
      from: "uploaded",
      to: "processing",
    });
    expect(db.row("scans").status).toBe("processing");
    expect(db.log.at(-1)).toMatchObject({
      table: "scans",
      op: "update",
      values: { status: "processing" },
      filters: [
        ["id", SCAN],
        ["status", "uploaded"],
      ],
    });
  });

  it("refuses an invalid transition without touching the DB", async () => {
    const db = scanDb("uploaded");
    await expect(
      applyTransition(db.client, {
        kind: "scan",
        id: SCAN,
        from: "uploaded",
        to: "published",
      }),
    ).rejects.toThrow(InvalidTransitionError);
    expect(db.log).toEqual([]);
  });

  it("raises a conflict when another writer moved the row first", async () => {
    const db = scanDb("processing");
    db.beforeNext("scans", "update", () => {
      db.row("scans").status = "failed_qc";
    });
    await expect(
      applyTransition(db.client, {
        kind: "scan",
        id: SCAN,
        from: "processing",
        to: "pending_review",
      }),
    ).rejects.toThrow(TransitionConflictError);
    expect(db.row("scans").status).toBe("failed_qc");
  });

  it("raises a conflict when the row does not exist", async () => {
    const db = createFakeDb({ climbs: [] });
    await expect(
      applyTransition(db.client, {
        kind: "climb",
        id: SCAN,
        from: "pending_review",
        to: "rejected",
      }),
    ).rejects.toThrow(TransitionConflictError);
  });

  it("refuses to publish a scan without a canonical GLB, before updating", async () => {
    const db = scanDb("pending_review", false);
    await expect(
      applyTransition(db.client, {
        kind: "scan",
        id: SCAN,
        from: "pending_review",
        to: "published",
      }),
    ).rejects.toThrow(MissingMeshError);
    expect(db.log.some((l) => l.op === "update")).toBe(false);
    expect(db.row("scans").status).toBe("pending_review");
  });

  it("publishes a scan that has its mesh", async () => {
    const db = scanDb("pending_review");
    await applyTransition(db.client, {
      kind: "scan",
      id: SCAN,
      from: "pending_review",
      to: "published",
    });
    expect(db.row("scans").status).toBe("published");
  });

  it.each(["scan", "climb"] as const)(
    "refuses the %s takedown edge (published → rejected) to plain callers",
    async (kind) => {
      const db = createFakeDb({ scans: [{ id: SCAN, status: "published" }] });
      await expect(
        applyTransition(db.client, {
          kind,
          id: SCAN,
          from: "published",
          to: "rejected",
        }),
      ).rejects.toThrow(InvalidTransitionError);
      expect(db.log).toEqual([]);
    },
  );

  it("re-queues a failed_qc scan (failed_qc → processing)", async () => {
    const db = scanDb("failed_qc", false);
    await applyTransition(db.client, {
      kind: "scan",
      id: SCAN,
      from: "failed_qc",
      to: "processing",
      patch: { qc_report: null },
    });
    expect(db.row("scans")).toMatchObject({
      status: "processing",
      qc_report: null,
    });
  });

  it("wraps DB errors", async () => {
    const db = scanDb("uploaded");
    db.failNext("scans", "update", "connection reset");
    await expect(
      applyTransition(db.client, {
        kind: "scan",
        id: SCAN,
        from: "uploaded",
        to: "processing",
      }),
    ).rejects.toThrow(LifecycleDbError);
  });
});

const REPORT: QcReport = {
  pipeline_version: "qc-1.0.0",
  checks: [
    {
      id: "tri_count",
      pass: true,
      severity: "error",
      message: "20,000 triangles",
      data: { count: 20000 },
    },
    {
      id: "texture_res",
      pass: false,
      severity: "warning",
      message: "Texture is 1024 px",
      data: { px: 1024 },
    },
  ],
  extents_m: { width: 2.5, height: 1.8, depth: 1.8 },
  recentred: true,
};

const RESULTS = {
  glb_path: "uploads/u/s/derived/x.glb",
  content_hash: HASH,
  tri_count: 20000,
  texture_res: 1024,
  qc_report: REPORT,
} satisfies ScanQcPatch;

const toReview = (patch: unknown): TransitionRequest => ({
  kind: "scan",
  id: SCAN,
  from: "processing",
  to: "pending_review",
  patch: patch as ScanQcPatch,
});

describe("applyTransition: QC result patch", () => {
  it("writes the patch and the status in ONE compare-and-set update", async () => {
    const db = scanDb("processing", false);
    await applyTransition(db.client, toReview(RESULTS));
    const updates = db.log.filter((l) => l.op === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      values: { ...RESULTS, status: "pending_review" },
      filters: [
        ["id", SCAN],
        ["status", "processing"],
      ],
    });
    expect(db.row("scans")).toMatchObject({
      ...RESULTS,
      status: "pending_review",
    });
  });

  it("on a CAS conflict writes nothing, patch included", async () => {
    const db = scanDb("processing", false);
    db.beforeNext("scans", "update", () => {
      db.row("scans").status = "failed_qc";
    });
    await expect(applyTransition(db.client, toReview(RESULTS))).rejects.toThrow(
      TransitionConflictError,
    );
    expect(db.row("scans")).toEqual({
      id: SCAN,
      status: "failed_qc",
      glb_path: null,
      content_hash: null,
    });
  });

  it.each([
    ["status", { status: "published" }],
    ["uploader_id", { uploader_id: "x" }],
    ["openbeta_area_id", { openbeta_area_id: "x" }],
    ["license", { license: "CC0" }],
    ["unknown alongside valid keys", { ...RESULTS, extra: 1 }],
  ])("refuses unknown key %s before touching the DB", async (_k, patch) => {
    const db = scanDb("processing");
    await expect(applyTransition(db.client, toReview(patch))).rejects.toThrow(
      InvalidPatchError,
    );
    expect(db.log).toEqual([]);
  });

  const check0 = REPORT.checks[0];
  it.each([
    ["non-object patch", "glb_path"],
    ["content_hash", { content_hash: "not-a-hash" }],
    ["glb_path", { glb_path: "" }],
    ["tri_count", { tri_count: -1 }],
    ["texture_res", { texture_res: 0 }],
    ["undefined value", { glb_path: undefined }],
    ["report with corners", { qc_report: { ...REPORT, bbox_min: [0, 0, 0] } }],
    [
      "report extents with corners",
      {
        qc_report: {
          ...REPORT,
          extents_m: { width: 1, height: 1, depth: 1, min: [1, 2, 3] },
        },
      },
    ],
    [
      "report data naming coordinates",
      {
        qc_report: {
          ...REPORT,
          checks: [{ ...check0, data: { origin_x: 5e5 } }],
        },
      },
    ],
    [
      "report data with strings",
      {
        qc_report: {
          ...REPORT,
          checks: [{ ...check0, data: { exported: "scan.obj" } }],
        },
      },
    ],
    [
      "report check with extra key",
      { qc_report: { ...REPORT, checks: [{ ...check0, file: "a.obj" }] } },
    ],
    ["report with no checks", { qc_report: { ...REPORT, checks: [] } }],
  ])("refuses an invalid %s", async (_k, patch) => {
    const db = scanDb("processing");
    await expect(applyTransition(db.client, toReview(patch))).rejects.toThrow(
      InvalidPatchError,
    );
    expect(db.log).toEqual([]);
  });

  it.each([{}, { qc_report: null }])(
    "refuses any climb patch (%j)",
    async (patch) => {
      const db = createFakeDb({
        climbs: [{ id: SCAN, status: "pending_review" }],
      });
      await expect(
        applyTransition(db.client, {
          kind: "climb",
          id: SCAN,
          from: "pending_review",
          to: "published",
          patch,
        } as unknown as TransitionRequest),
      ).rejects.toThrow(InvalidPatchError);
      expect(db.log).toEqual([]);
    },
  );

  it("refuses to send a report with failing error checks to review", async () => {
    const failing = {
      ...REPORT,
      checks: [
        { id: "tri_count", pass: false, severity: "error", message: "Too few" },
      ],
    } satisfies QcReport;
    const db = scanDb("processing");
    await expect(
      applyTransition(db.client, toReview({ qc_report: failing })),
    ).rejects.toThrow(/must go to failed_qc/);
    expect(db.log).toEqual([]);
    // ...while failed_qc takes it, report included.
    await applyTransition(db.client, {
      kind: "scan",
      id: SCAN,
      from: "processing",
      to: "failed_qc",
      patch: { qc_report: failing },
    });
    expect(db.row("scans")).toMatchObject({
      status: "failed_qc",
      qc_report: failing,
    });
  });

  it("publishes when the patch supplies the mesh fields (no read needed)", async () => {
    const db = scanDb("pending_review", false);
    await applyTransition(db.client, {
      kind: "scan",
      id: SCAN,
      from: "pending_review",
      to: "published",
      patch: { glb_path: "published/x.glb", content_hash: HASH },
    });
    expect(db.row("scans")).toMatchObject({
      status: "published",
      glb_path: "published/x.glb",
    });
    expect(db.log.map((l) => l.op)).toEqual(["update"]);
  });

  it("publishes when the patch supplies one mesh field and the row the other", async () => {
    const db = createFakeDb({
      scans: [
        {
          id: SCAN,
          status: "pending_review",
          glb_path: null,
          content_hash: HASH,
        },
      ],
    });
    await applyTransition(db.client, {
      kind: "scan",
      id: SCAN,
      from: "pending_review",
      to: "published",
      patch: { glb_path: "published/x.glb" },
    });
    expect(db.row("scans").status).toBe("published");
  });

  it("refuses to publish when the patch nulls out the row's mesh", async () => {
    const db = scanDb("pending_review");
    await expect(
      applyTransition(db.client, {
        kind: "scan",
        id: SCAN,
        from: "pending_review",
        to: "published",
        patch: { glb_path: null },
      }),
    ).rejects.toThrow(MissingMeshError);
    expect(db.log.some((l) => l.op === "update")).toBe(false);
  });
});
