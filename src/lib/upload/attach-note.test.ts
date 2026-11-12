import { describe, expect, it, vi } from "vitest";
import { checkAttachNote, loadAttachNote, saveAttachNote } from "./attach-note";

const SCAN = "20000000-0000-4000-8000-0000000000a1";

function client(result: { data?: unknown; error?: unknown }) {
  const upsert = vi.fn(async () => result);
  const from = vi.fn(() => ({
    upsert,
    select: () => ({
      eq: () => ({ maybeSingle: async () => result }),
    }),
  }));
  return { c: { from } as never, upsert, from };
}

describe("checkAttachNote", () => {
  it("treats blank as no note and trims", () => {
    expect(checkAttachNote("   ")).toEqual({ ok: true, note: null });
    expect(checkAttachNote(undefined)).toEqual({ ok: true, note: null });
    expect(checkAttachNote("  big boulder  ")).toEqual({
      ok: true,
      note: "big boulder",
    });
  });
  it("rejects over-long notes and coordinate pairs", () => {
    expect(checkAttachNote("x".repeat(501)).ok).toBe(false);
    expect(checkAttachNote("x".repeat(500)).ok).toBe(true);
    expect(checkAttachNote("it is at 43.1234, -71.5678").ok).toBe(false);
    expect(checkAttachNote("43.1234 -71.5678").ok).toBe(false);
    expect(checkAttachNote("V3 near the 2.5 mile marker").ok).toBe(true);
  });
});

describe("saveAttachNote", () => {
  it("upserts the trimmed note for the scan", async () => {
    const { c, upsert, from } = client({ error: null });
    expect(await saveAttachNote(c, SCAN, " hello ")).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith("scan_attach_notes");
    expect(upsert).toHaveBeenCalledWith(
      { scan_id: SCAN, note: "hello" },
      { onConflict: "scan_id" },
    );
  });
  it("writes nothing for a blank note or a bad id", async () => {
    const { c, upsert } = client({ error: null });
    expect(await saveAttachNote(c, SCAN, "")).toEqual({ ok: true });
    expect((await saveAttachNote(c, "nope", "hi")).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
  it("reports a database failure without leaking its message", async () => {
    const { c } = client({ error: { message: "secret detail" } });
    const res = await saveAttachNote(c, SCAN, "hi");
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain("secret");
  });
});

describe("loadAttachNote", () => {
  it("returns the note or null", async () => {
    expect(await loadAttachNote(client({ data: { note: "hi" } }).c, SCAN)).toBe(
      "hi",
    );
    expect(await loadAttachNote(client({ data: null }).c, SCAN)).toBeNull();
    expect(await loadAttachNote(client({ data: null }).c, "bad")).toBeNull();
  });
});
