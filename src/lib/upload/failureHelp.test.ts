import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QcReport } from "../types";
import {
  isUploadFailureUserFixable,
  qcFailureHelp,
  uploadFailureHelp,
  type UploadFailureCode,
} from "./failureHelp";
import {
  explainUploadFailure,
  qcHelpForScan,
  withUploadHelp,
} from "./failures";
import { checkUploadFile } from "./validate";

const REF = {
  reference: "SB-0123ABCD",
  reportPath: "/report-problem?ref=SB-0123ABCD",
};
const ALL: UploadFailureCode[] = [
  "session_expired",
  "unsupported_file",
  "obj_needs_zip",
  "empty_file",
  "file_too_large",
  "zip_no_mesh",
  "bad_area_id",
  "unknown_area",
  "area_needed",
  "scan_not_found",
  "past_upload",
  "upload_unfinished",
  "network",
  "scan_create_failed",
  "area_flag_failed",
  "scan_check_failed",
  "storage_check_failed",
  "enqueue_failed",
];

function fakeDb(insertError: unknown = null, rows: unknown[] = []) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const chain = {
    eq: () => chain,
    order: () => chain,
    limit: async () => ({ data: rows }),
  };
  const db = {
    from: () => ({ insert, select: () => chain }),
  } as unknown as SupabaseClient;
  return { db, insert };
}

const report = (checks: QcReport["checks"]): QcReport => ({
  pipeline_version: "qc-1.2.0",
  checks,
  extents_m: null,
});

describe("uploadFailureHelp", () => {
  it.each(ALL)("%s has every part of the rubric", (code) => {
    const h = uploadFailureHelp(code);
    expect(h.stageLabel).toBeTruthy();
    expect(h.whatHappened.length).toBeGreaterThan(10);
    expect(h.whatYouCanDo.length).toBeGreaterThan(0);
    expect(h.nextSteps.length).toBeGreaterThan(0);
    expect(h.userFixable).toBe(isUploadFailureUserFixable(code));
  });

  it("only attaches a reference to failures on our side", () => {
    expect(uploadFailureHelp("empty_file", REF).reference).toBeUndefined();
    const ours = uploadFailureHelp("scan_create_failed", REF);
    expect(ours.reference).toBe(REF.reference);
    expect(ours.reportPath).toBe(REF.reportPath);
    expect(ours.nextSteps[0]).toContain(REF.reference);
  });

  it("maps the file checks to codes", () => {
    const code = (name: string, size = 10) => {
      const r = checkUploadFile({ name, size });
      return r.ok ? null : r.code;
    };
    expect(code("a.obj")).toBe("obj_needs_zip");
    expect(code("a.stl")).toBe("unsupported_file");
    expect(code("a.glb", 0)).toBe("empty_file");
    expect(code("a.glb", 201 * 1024 * 1024)).toBe("file_too_large");
  });
});

describe("qcFailureHelp", () => {
  it("is null when nothing blocked the scan", () => {
    expect(qcFailureHelp(null)).toBeNull();
    expect(
      qcFailureHelp(
        report([
          { id: "color", pass: false, severity: "warning", message: "w" },
        ]),
      ),
    ).toBeNull();
  });

  it("explains a too-few-triangles failure with the check's own advice", () => {
    const msg =
      "Only 9,000 triangles; we need at least 10,000. Export at a higher mesh quality.";
    const h = qcFailureHelp(
      report([
        { id: "tri_count", pass: false, severity: "error", message: msg },
      ]),
    )!;
    expect(h.stage).toBe("qc");
    expect(h.userFixable).toBe(true);
    expect(h.whatHappened).toContain("1 problem");
    expect(h.whatYouCanDo).toEqual([msg]);
    expect(h.reference).toBeUndefined();
  });

  it("treats pipeline_error as ours and carries the reference", () => {
    const r = report([
      { id: "pipeline_error", pass: false, severity: "error", message: "ours" },
    ]);
    const h = qcFailureHelp(r, REF)!;
    expect(h.userFixable).toBe(false);
    expect(h.whatHappened).toContain("isn't a problem with your file");
    expect(h.reference).toBe(REF.reference);
  });
});

describe("server helpers", () => {
  it("does not log a failure the user can fix", async () => {
    const { db, insert } = fakeDb();
    const h = await explainUploadFailure(db, "file_too_large", { userId: "u" });
    expect(insert).not.toHaveBeenCalled();
    expect(h.reference).toBeUndefined();
  });

  it("logs our-side failures with stage, code and scan id", async () => {
    const { db, insert } = fakeDb();
    const h = await explainUploadFailure(db, "enqueue_failed", {
      userId: "u",
      scanId: "s",
    });
    expect(insert).toHaveBeenCalledOnce();
    expect(insert.mock.calls[0]![0]).toMatchObject({
      stage: "qc",
      code: "enqueue_failed",
      user_id: "u",
      scan_id: "s",
    });
    expect(h.reference).toBe(insert.mock.calls[0]![0].reference);
    expect(h.reportPath).toContain(h.reference);
  });

  it("omits the reference when the log write fails", async () => {
    const { db } = fakeDb({ code: "x" });
    const h = await explainUploadFailure(db, "scan_create_failed", {
      userId: "u",
    });
    expect(h.userFixable).toBe(false);
    expect(h.reference).toBeUndefined();
    expect(h.nextSteps[0]).toMatch(/report the problem/);
  });

  it("withUploadHelp adds help to failures and leaves successes alone", async () => {
    const { db } = fakeDb();
    const ok = await withUploadHelp(
      () => db,
      { ok: true as boolean },
      { userId: "u" },
    );
    expect(ok).toEqual({ ok: true });
    const bad = await withUploadHelp(
      () => db,
      {
        ok: false as boolean,
        error: "e",
        code: "empty_file" as UploadFailureCode,
      },
      { userId: "u" },
    );
    expect(bad).toMatchObject({ error: "e", help: { userFixable: true } });
  });

  it("withUploadHelp still returns help when the service client can't be made", async () => {
    const r = await withUploadHelp(
      () => {
        throw new Error("no env");
      },
      { ok: false as boolean, code: "scan_create_failed" as UploadFailureCode },
      { userId: "u" },
    );
    expect(r).toMatchObject({ help: { userFixable: false } });
  });

  it("qcHelpForScan looks up the logged reference for our-side failures", async () => {
    const { db } = fakeDb(null, [{ reference: "SB-0123ABCD" }]);
    const r = report([
      { id: "pipeline_error", pass: false, severity: "error", message: "ours" },
    ]);
    expect((await qcHelpForScan(db, "s", r))?.reference).toBe("SB-0123ABCD");
    expect((await qcHelpForScan(null, "s", r))?.reference).toBeUndefined();
  });
});
