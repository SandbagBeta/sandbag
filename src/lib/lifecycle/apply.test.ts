import { describe, expect, it } from "vitest";
import {
  applyTransition,
  LifecycleDbError,
  MissingMeshError,
  TransitionConflictError,
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
