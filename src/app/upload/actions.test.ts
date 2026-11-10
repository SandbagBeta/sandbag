import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "00000000-0000-4000-8000-0000000000a1";
const ATTACKER = "00000000-0000-4000-8000-0000000000b1";
const SCAN = "20000000-0000-4000-8000-0000000000a1";
const AREA = "30000000-0000-4000-8000-0000000000a1";

const m = vi.hoisted(() => ({
  user: null as { id: string } | null,
  inserts: [] as unknown[],
  flag: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../../lib/location", () => ({ flagAreaSensitive: m.flag }));
vi.mock("../../lib/upload/pipeline", () => ({ enqueueQc: m.enqueue }));
// The session (cookie) client; the service-role client is never imported.
vi.mock("../../lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: m.user } }) },
    from: () => ({
      insert: (row: unknown) => {
        m.inserts.push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: SCAN }, error: null }),
          }),
        };
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: SCAN, uploader_id: ATTACKER, status: "uploaded" },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

const { createScan, notifyUploadComplete } = await import("./actions");

beforeEach(() => {
  m.user = { id: USER };
  m.inserts.length = 0;
  m.flag.mockReset().mockResolvedValue({ status: "flagged" });
  m.enqueue.mockReset();
});

describe("upload server actions", () => {
  it("take the uploader and the flagging profile from the session, not the input", async () => {
    const input = {
      fileName: "a.glb",
      fileSize: 10,
      areaId: AREA,
      sensitive: true,
      uploader_id: ATTACKER,
      profileId: ATTACKER,
    } as Parameters<typeof createScan>[0];
    const r = await createScan(input);
    expect(r.ok).toBe(true);
    expect(m.inserts).toEqual([
      { uploader_id: USER, openbeta_area_id: AREA, openbeta_climb_id: null },
    ]);
    expect(m.flag).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ profileId: USER, areaId: AREA }),
    );
  });

  it("only treats a literal true as checked", async () => {
    await createScan({
      fileName: "a.glb",
      fileSize: 10,
      areaId: AREA,
      sensitive: "on" as unknown as boolean,
    });
    expect(m.flag).not.toHaveBeenCalled();
  });

  it("refuse signed-out callers", async () => {
    m.user = null;
    expect((await createScan({ fileName: "a.glb", fileSize: 10 })).ok).toBe(
      false,
    );
    expect((await notifyUploadComplete(SCAN)).ok).toBe(false);
    expect(m.inserts).toEqual([]);
  });

  it("notifyUploadComplete rejects a scan owned by someone else", async () => {
    expect((await notifyUploadComplete(SCAN)).ok).toBe(false);
    expect(m.enqueue).not.toHaveBeenCalled();
  });
});
