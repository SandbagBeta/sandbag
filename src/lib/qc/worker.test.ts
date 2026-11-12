// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createFakeDb } from "../lifecycle/fake-db";
import { isQcRequestAuthorized } from "./auth";
import { failStuckScans, processNextQcJob } from "./worker";

const DIR = fileURLToPath(new URL("../../../fixtures/qc/", import.meta.url));
const SCAN = "00000000-0000-4000-8000-0000000000a1";
const UPLOADER = "00000000-0000-4000-8000-0000000000b1";
const JOB = "00000000-0000-4000-8000-0000000000c1";
const TOKEN = "00000000-0000-4000-8000-0000000000d1";
const rawPath = (ext: string) => `${UPLOADER}/${SCAN}/raw/source.${ext}`;

interface Setup {
  fixture?: string;
  ext?: string;
  status?: string;
  exhausted?: boolean;
  /** Pretend the stored object is this size (without holding the bytes). */
  size?: number;
  downloadFails?: boolean;
  failState?: "queued" | "failed";
  uploadFails?: boolean;
}

function setup(s: Setup = {}) {
  const ext = s.ext ?? (s.fixture?.split(".").pop() as string) ?? "glb";
  const bytes = s.fixture ? readFileSync(DIR + s.fixture) : new Uint8Array(1);
  const fake = createFakeDb({
    scans: [{ id: SCAN, status: s.status ?? "uploaded", raw_path: null }],
  });
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let claimed = false;
  const downloads: string[] = [];
  const uploads: { key: string; bytes: Uint8Array; type?: string }[] = [];
  const client = Object.assign(fake.client, {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      if (fn === "claim_qc_job") {
        const first = !claimed;
        claimed = true;
        return {
          data: first
            ? [
                {
                  job_id: JOB,
                  scan_id: SCAN,
                  raw_path: rawPath(ext),
                  attempt: 1,
                  max_attempts: 3,
                  lease_token: TOKEN,
                  exhausted: s.exhausted ?? false,
                },
              ]
            : [],
          error: null,
        };
      }
      if (fn === "fail_qc_job")
        return { data: s.failState ?? "queued", error: null };
      if (fn === "complete_qc_job") return { data: true, error: null };
      if (fn === "list_stuck_qc_scans")
        return { data: [{ scan_id: SCAN }], error: null };
      return { data: null, error: { message: "unexpected rpc" } };
    },
    storage: {
      from: () => ({
        list: async (_folder: string, o: { search: string }) => ({
          data: [
            { name: o.search, metadata: { size: s.size ?? bytes.length } },
          ],
          error: null,
        }),
        upload: async (
          key: string,
          body: Uint8Array,
          o: { contentType?: string },
        ) => {
          if (s.uploadFails && key.endsWith(".glb")) {
            return { data: null, error: { message: "503 secret-path" } };
          }
          uploads.push({ key, bytes: body, type: o.contentType });
          return { data: { path: key }, error: null };
        },
        download: async (p: string) => {
          downloads.push(p);
          return s.downloadFails
            ? { data: null, error: { message: "503 secret-path" } }
            : { data: new Blob([bytes as BlobPart]), error: null };
        },
      }),
    },
  }) as unknown as SupabaseClient;
  const logs: string[] = [];
  const run = () => processNextQcJob(client, { log: (l) => logs.push(l) });
  const scan = () => fake.row("scans");
  const names = () => calls.map((c) => c.fn);
  return { fake, run, scan, calls, names, downloads, uploads, logs, client };
}

describe("processNextQcJob", () => {
  it("is idle when nothing is claimable", async () => {
    const t = setup();
    await t.run();
    expect((await t.run()).result).toBe("idle");
  });

  it("passes a good scan to pending_review with results in one patch", async () => {
    const t = setup({ fixture: "good-polycam-like.glb" });
    expect(await t.run()).toEqual({ result: "passed", scanId: SCAN });
    expect(t.scan()).toMatchObject({
      status: "pending_review",
      raw_path: rawPath("glb"),
    });
    // Canonical GLB (ADR 003 steps 4-5): derived key, hash, thumbnail, one patch.
    const glb = t.uploads.find((u) => u.key.endsWith(".glb"))!;
    const hash = createHash("sha256").update(glb.bytes).digest("hex");
    expect(glb.key).toBe(`${UPLOADER}/${SCAN}/derived/${hash}.glb`);
    expect(glb.type).toBe("model/gltf-binary");
    expect(t.scan()).toMatchObject({ glb_path: glb.key, content_hash: hash });
    expect(t.uploads.map((u) => u.key)).toContain(
      `${UPLOADER}/${SCAN}/derived/thumb.webp`,
    );
    expect(t.scan().qc_report).toHaveProperty("recentred");
    expect(t.scan().tri_count).toBeGreaterThan(0);
    expect(t.scan().qc_report).toMatchObject({
      pipeline_version: expect.any(String),
    });
    // Hop to processing, then one atomic result update.
    const writes = t.fake.log.filter((l) => l.op === "update");
    expect(writes.map((w) => w.values?.status)).toEqual([
      "processing",
      "pending_review",
    ]);
    expect(writes[1]?.values).toHaveProperty("qc_report");
    expect(t.names()).toEqual(["claim_qc_job", "complete_qc_job"]);
    expect(t.logs.join("\n")).toMatch(/peak RSS/);
  });

  it("sends a genuinely bad mesh to failed_qc and completes the job (no retry)", async () => {
    const t = setup({ fixture: "bad-flat.ply" });
    expect((await t.run()).result).toBe("failed");
    expect(t.scan().status).toBe("failed_qc");
    expect(t.scan().glb_path).toBeUndefined();
    expect(t.scan().texture_res).toBeNull();
    expect(t.names()).toContain("complete_qc_job");
    expect(t.names()).not.toContain("fail_qc_job");
  });

  it("fails a corrupt file as a verdict", async () => {
    const t = setup({ fixture: "bad-truncated.glb" });
    expect((await t.run()).result).toBe("failed");
    expect(t.scan().status).toBe("failed_qc");
  });

  it("fails an oversize object with a clear message, without downloading it", async () => {
    const t = setup({
      fixture: "good-polycam-like.glb",
      size: 999 * 1024 * 1024,
    });
    expect((await t.run()).result).toBe("failed");
    expect(t.downloads).toEqual([]);
    const report = t.scan().qc_report as {
      checks: { id: string; message: string }[];
    };
    expect(report.checks[0]).toMatchObject({ id: "file_size" });
    expect(report.checks[0]?.message).toMatch(/limit/);
  });

  it("a failed scan builds and uploads nothing", async () => {
    const t = setup({ fixture: "bad-flat.ply" });
    expect((await t.run()).result).toBe("failed");
    expect(t.uploads).toHaveLength(0);
    expect(t.scan()).not.toHaveProperty("glb_path");
  });

  it("an upload failure is an infrastructure error: retry, no mesh recorded", async () => {
    const t = setup({ fixture: "good-polycam-like.glb", uploadFails: true });
    expect((await t.run()).result).toBe("retry");
    expect(t.scan().status).not.toBe("pending_review");
    expect(t.logs.join(" ")).not.toMatch(/secret-path/);
  });

  it("re-runs a failed_qc scan (maintainer re-run) back through processing", async () => {
    const t = setup({ fixture: "good-polycam-like.glb", status: "failed_qc" });
    expect((await t.run()).result).toBe("passed");
    expect(t.scan().status).toBe("pending_review");
  });

  it("continues a processing scan (retry after a crash)", async () => {
    const t = setup({ fixture: "good-polycam-like.glb", status: "processing" });
    expect((await t.run()).result).toBe("passed");
    expect(t.fake.log.filter((l) => l.op === "update")).toHaveLength(1);
  });

  it("leaves scans in other states alone", async () => {
    const t = setup({ fixture: "good-polycam-like.glb", status: "published" });
    expect((await t.run()).result).toBe("skipped");
    expect(t.scan().status).toBe("published");
    expect(t.fake.log.some((l) => l.op === "update")).toBe(false);
  });

  it("stops when another runner moved the scan first", async () => {
    const t = setup({ fixture: "good-polycam-like.glb" });
    t.fake.beforeNext("scans", "update", () => {
      t.fake.row("scans").status = "processing";
    });
    expect((await t.run()).result).toBe("skipped");
    expect(t.names()).toContain("complete_qc_job");
  });

  it("treats a storage failure as an infrastructure error: retry, scan untouched", async () => {
    const t = setup({ fixture: "good-polycam-like.glb", downloadFails: true });
    expect((await t.run()).result).toBe("retry");
    expect(t.scan().status).toBe("uploaded");
    const fail = t.calls.find((c) => c.fn === "fail_qc_job");
    expect(fail?.args.p_error).toBe("qc pipeline error");
    expect(JSON.stringify(fail?.args)).not.toContain("secret-path");
  });

  it("after the last retry, fails the scan with the 'our side' message", async () => {
    const t = setup({
      fixture: "good-polycam-like.glb",
      downloadFails: true,
      failState: "failed",
    });
    expect((await t.run()).result).toBe("exhausted");
    expect(t.scan().status).toBe("failed_qc");
    expect(JSON.stringify(t.scan().qc_report)).toMatch(/our side/);
  });

  it("does not re-run QC when the last attempt's lease expired", async () => {
    const t = setup({ fixture: "good-polycam-like.glb", exhausted: true });
    expect((await t.run()).result).toBe("exhausted");
    expect(t.downloads).toEqual([]);
    expect(t.scan().status).toBe("failed_qc");
    expect(t.names()).toContain("fail_qc_job");
  });

  it("never logs coordinates or file contents", async () => {
    const t = setup({ fixture: "good-georeferenced.zip" });
    await t.run();
    // Georeferenced fixture offsets are large numbers; nothing numeric but
    // timings and ids may appear.
    expect(t.logs.join("\n")).not.toMatch(/\d{6,}\.\d/);
  });
});

describe("failStuckScans", () => {
  it("moves stuck processing scans to failed_qc", async () => {
    const t = setup({ status: "processing" });
    expect(await failStuckScans(t.client, () => {})).toBe(1);
    expect(t.scan().status).toBe("failed_qc");
  });

  it("skips a scan that finished in the meantime", async () => {
    const t = setup({ status: "pending_review" });
    expect(await failStuckScans(t.client, () => {})).toBe(0);
    expect(t.scan().status).toBe("pending_review");
  });
});

describe("isQcRequestAuthorized", () => {
  const secret = "s".repeat(40);
  it("accepts the exact bearer secret", () => {
    expect(isQcRequestAuthorized(`Bearer ${secret}`, secret)).toBe(true);
  });
  it.each([null, "", "Bearer ", `Bearer ${secret}x`, secret, "Bearer short"])(
    "rejects %j",
    (h) => expect(isQcRequestAuthorized(h, secret)).toBe(false),
  );
  it("fails closed with no or a short server secret", () => {
    expect(isQcRequestAuthorized("Bearer abc", "abc")).toBe(false);
    expect(isQcRequestAuthorized(`Bearer ${secret}`, undefined)).toBe(false);
  });
});
