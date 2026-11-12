import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createScanForUpload,
  SENSITIVE_REASON,
  verifyUploadComplete,
  type CreateScanInput,
} from "./scans";

const USER = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b1";
const SCAN = "20000000-0000-4000-8000-0000000000a1";
const AREA = "30000000-0000-4000-8000-0000000000a1";
const CLIMB = "40000000-0000-4000-8000-0000000000a1";

type Res = { data: unknown; error: { code?: string } | null };

/** Fake of the PostgREST + Storage chains scans.ts uses; records calls. */
function fakeClient(opts: { insert?: Res; scan?: Res; list?: Res } = {}) {
  const calls = {
    inserts: [] as unknown[],
    tables: [] as string[],
    lists: [] as string[],
    buckets: [] as string[],
  };
  const client = {
    from(table: string) {
      calls.tables.push(table);
      return {
        insert(row: unknown) {
          calls.inserts.push(row);
          return {
            select: () => ({
              single: async () =>
                opts.insert ?? { data: { id: SCAN }, error: null },
            }),
          };
        },
        select: () => ({
          eq: () => ({
            maybeSingle: async () => opts.scan ?? { data: null, error: null },
          }),
        }),
      };
    },
    storage: {
      from(bucket: string) {
        calls.buckets.push(bucket);
        return {
          list: async (folder: string) => {
            calls.lists.push(folder);
            return opts.list ?? { data: [], error: null };
          },
        };
      },
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const base: CreateScanInput = {
  fileName: "Buttermilks Grandpa Peabody.ply",
  fileSize: 150 * 1024 * 1024,
};

describe("createScanForUpload", () => {
  it("inserts only the client-writable columns and returns the raw key", async () => {
    const { client, calls } = fakeClient();
    const flagArea = vi.fn();
    const r = await createScanForUpload(
      client,
      USER,
      { ...base, areaId: AREA, climbId: CLIMB },
      { flagArea },
    );
    expect(r).toEqual({
      ok: true,
      scanId: SCAN,
      objectName: `${USER}/${SCAN}/raw/source.ply`,
      contentType: "application/octet-stream",
    });
    expect(calls.tables).toEqual(["scans"]);
    expect(calls.inserts).toEqual([
      { uploader_id: USER, openbeta_area_id: AREA, openbeta_climb_id: CLIMB },
    ]);
    const allowed = [
      "uploader_id",
      "openbeta_area_id",
      "openbeta_climb_id",
      "capture_app",
      "captured_at",
    ];
    expect(
      Object.keys(calls.inserts[0] as object).every((k) => allowed.includes(k)),
    ).toBe(true);
    expect(flagArea).not.toHaveBeenCalled();
  });

  it("never puts the original filename in the key", async () => {
    const { client } = fakeClient();
    const r = await createScanForUpload(client, USER, base, {
      flagArea: vi.fn(),
    });
    expect(r.ok && r.objectName).not.toMatch(/Buttermilks|Peabody/);
  });

  it("stores blank OpenBeta ids as null and rejects non-UUIDs before inserting", async () => {
    const { client, calls } = fakeClient();
    await createScanForUpload(
      client,
      USER,
      { ...base, areaId: "  ", climbId: "" },
      { flagArea: vi.fn() },
    );
    expect(calls.inserts).toEqual([
      { uploader_id: USER, openbeta_area_id: null, openbeta_climb_id: null },
    ]);
    for (const bad of [{ areaId: "bishop" }, { climbId: "123" }]) {
      const f = fakeClient();
      const r = await createScanForUpload(
        f.client,
        USER,
        { ...base, ...bad },
        { flagArea: vi.fn() },
      );
      expect(r.ok).toBe(false);
      expect(f.calls.inserts).toEqual([]);
    }
  });

  it("rejects an invalid file before touching the database", async () => {
    const { client, calls } = fakeClient();
    const r = await createScanForUpload(
      client,
      USER,
      { fileName: "x.ply.exe", fileSize: 5 },
      { flagArea: vi.fn() },
    );
    expect(r.ok).toBe(false);
    expect(calls.tables).toEqual([]);
  });

  it("flags the area with the session profile id when the box is checked", async () => {
    const { client } = fakeClient();
    const flagArea = vi.fn().mockResolvedValue({ status: "flagged" });
    // An attacker-supplied profileId in the input is ignored.
    const input = {
      ...base,
      areaId: AREA.toUpperCase(),
      sensitive: true,
      profileId: OTHER,
    } as CreateScanInput;
    await createScanForUpload(client, USER, input, { flagArea });
    expect(flagArea).toHaveBeenCalledExactlyOnceWith({
      areaId: AREA,
      profileId: USER,
      reason: SENSITIVE_REASON,
    });
  });

  it("does not flag without the box, and needs an area id to flag", async () => {
    const flagArea = vi.fn();
    await createScanForUpload(
      fakeClient().client,
      USER,
      { ...base, areaId: AREA, sensitive: false },
      { flagArea },
    );
    const f = fakeClient();
    const r = await createScanForUpload(
      f.client,
      USER,
      { ...base, sensitive: true },
      { flagArea },
    );
    expect(flagArea).not.toHaveBeenCalled();
    expect(r).toEqual({
      ok: false,
      error: expect.stringMatching(/area id/),
      code: "area_needed",
    });
    expect(f.calls.inserts).toEqual([]);
  });

  it("creates no scan if the flag fails to land", async () => {
    const { client, calls } = fakeClient();
    const flagArea = vi.fn().mockRejectedValue(new Error("db down"));
    const r = await createScanForUpload(
      client,
      USER,
      { ...base, areaId: AREA, sensitive: true },
      { flagArea },
    );
    expect(r.ok).toBe(false);
    expect(calls.inserts).toEqual([]);
  });

  it("explains an area or climb missing from the OpenBeta cache (FK 23503)", async () => {
    const { client } = fakeClient({
      insert: { data: null, error: { code: "23503" } },
    });
    const r = await createScanForUpload(
      client,
      USER,
      { ...base, areaId: AREA },
      { flagArea: vi.fn() },
    );
    expect(r).toEqual({
      ok: false,
      error: expect.stringMatching(/doesn't know that OpenBeta/),
      code: "unknown_area",
    });
  });
});

describe("verifyUploadComplete", () => {
  const own = {
    data: { id: SCAN, uploader_id: USER, status: "uploaded" },
    error: null,
  };
  const file = (name: string, size = 1000) => ({
    data: [{ name, metadata: { size } }],
    error: null,
  });

  it("enqueues QC for the caller's uploaded scan once the raw file exists", async () => {
    const { client, calls } = fakeClient({
      scan: own,
      list: file("source.ply"),
    });
    const enqueue = vi.fn().mockResolvedValue(undefined);
    expect(await verifyUploadComplete(client, USER, SCAN, { enqueue })).toEqual(
      { ok: true },
    );
    expect(calls.buckets).toEqual(["uploads"]);
    expect(calls.lists).toEqual([`${USER}/${SCAN}/raw`]);
    expect(enqueue).toHaveBeenCalledExactlyOnceWith({
      scanId: SCAN,
      rawPath: `${USER}/${SCAN}/raw/source.ply`,
    });
    // No status write: the fake has no update(), so any attempt would throw.
  });

  it("reports enqueue_failed instead of throwing when the queue is down", async () => {
    const { client } = fakeClient({ scan: own, list: file("source.ply") });
    const enqueue = vi.fn().mockRejectedValue(new Error("down"));
    expect(
      await verifyUploadComplete(client, USER, SCAN, { enqueue }),
    ).toMatchObject({ ok: false, code: "enqueue_failed" });
  });

  it.each([
    [
      "someone else's scan",
      {
        data: { id: SCAN, uploader_id: OTHER, status: "uploaded" },
        error: null,
      },
    ],
    [
      "an anonymized scan",
      {
        data: { id: SCAN, uploader_id: null, status: "uploaded" },
        error: null,
      },
    ],
    ["a scan RLS hides", { data: null, error: null }],
    [
      "a processing scan",
      {
        data: { id: SCAN, uploader_id: USER, status: "processing" },
        error: null,
      },
    ],
    [
      "a published scan",
      {
        data: { id: SCAN, uploader_id: USER, status: "published" },
        error: null,
      },
    ],
  ])("rejects %s", async (_label, scan) => {
    const { client, calls } = fakeClient({ scan, list: file("source.ply") });
    const enqueue = vi.fn();
    const r = await verifyUploadComplete(client, USER, SCAN, { enqueue });
    expect(r.ok).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect(calls.lists).toEqual([]);
  });

  it.each([
    ["no file", { data: [], error: null }],
    ["a stray file only", file("notes.txt")],
    ["an oversized file", file("source.glb", 200 * 1024 * 1024 + 1)],
    ["a storage error", { data: null, error: { code: "500" } }],
  ])("rejects %s", async (_label, list) => {
    const enqueue = vi.fn();
    const r = await verifyUploadComplete(
      fakeClient({ scan: own, list }).client,
      USER,
      SCAN,
      { enqueue },
    );
    expect(r.ok).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID scan id without querying", async () => {
    const { client, calls } = fakeClient({ scan: own });
    expect(
      (await verifyUploadComplete(client, USER, "../x", { enqueue: vi.fn() }))
        .ok,
    ).toBe(false);
    expect(calls.tables).toEqual([]);
  });
});
