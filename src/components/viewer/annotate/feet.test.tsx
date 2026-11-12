import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Hold } from "@/lib/types";
import { holdsForSelection } from "../holds/holdMath";
import {
  buildSavePayload,
  describeSaveFailure,
} from "@/lib/annotations/savePayload";
import {
  browserStorage,
  clearDraft,
  draftKey,
  loadDraft,
  saveDraft,
  type DraftStorage,
} from "./draftStorage";
import {
  createEditorStore,
  editorReducer,
  initialEditorState,
  type EditorAction,
  type HoldPlacement,
} from "./editorStore";
import { sequenceLine } from "./pathDraw";
import { useDraft } from "./useDraft";

const at = (n: number): HoldPlacement => ({
  position: [n, 0, 0],
  normal: [0, 0, 1],
  face_index: n,
});
const place = (id: string, holdType: Hold["type"], n = 0): EditorAction => ({
  type: "place",
  id,
  at: at(n),
  holdType,
});
const run = (actions: EditorAction[]) =>
  actions.reduce(
    editorReducer,
    initialEditorState({ climbId: "c1", scanContentHash: "h1" }),
  );
const seqs = (s: { holds: Hold[] }) =>
  Object.fromEntries(s.holds.map((h) => [h.id, h.seq_order]));

describe("feet in the editor store", () => {
  it("places feet with null seq_order and does not number them", () => {
    const s = run([
      place("a", "start"),
      place("f1", "foot", 1),
      place("b", "hand", 2),
    ]);
    expect(seqs(s)).toEqual({ a: 0, f1: null, b: 1 });
  });

  it("delete and retype renumber only the non-foot holds", () => {
    let s = run([
      place("a", "start"),
      place("f", "foot", 1),
      place("b", "hand", 2),
      place("c", "finish", 3),
    ]);
    s = editorReducer(s, { type: "delete", id: "a" });
    expect(seqs(s)).toEqual({ f: null, b: 0, c: 1 });
    s = editorReducer(s, { type: "retype", id: "b", holdType: "foot" });
    expect(seqs(s)).toEqual({ f: null, b: null, c: 0 });
    s = editorReducer(s, { type: "retype", id: "f", holdType: "hand" });
    expect(seqs(s)).toEqual({ f: 0, b: null, c: 1 });
  });

  it("reorder indexes the sequence and leaves feet alone", () => {
    const s = run([
      place("f", "foot"),
      place("a", "start", 1),
      place("b", "hand", 2),
      { type: "reorder", id: "b", toIndex: 0 },
    ]);
    expect(seqs(s)).toEqual({ b: 0, a: 1, f: null });
  });

  it("restore replaces the edit and clears history", () => {
    let s = run([place("a", "start")]);
    expect(s.past).toHaveLength(1);
    s = editorReducer(s, {
      type: "restore",
      snapshot: { holds: [], paths: [], meta: s.meta },
    });
    expect(s.holds).toEqual([]);
    expect(s.past).toEqual([]);
  });
});

describe("sequenceLine", () => {
  it("excludes feet and needs two non-foot holds", () => {
    const s = run([
      place("a", "start", 0),
      place("f", "foot", 5),
      place("b", "finish", 1),
    ]);
    expect(sequenceLine(s.holds, "c1")?.points).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    const one = run([place("a", "start"), place("f", "foot", 5)]);
    expect(sequenceLine(one.holds, "c1")).toBeNull();
  });
});

describe("buildSavePayload with feet", () => {
  it("sends feet with seq_order null and a contiguous sequence otherwise", () => {
    const s = run([
      place("f", "foot", 9),
      place("a", "start"),
      place("b", "hand", 1),
    ]);
    const p = buildSavePayload({
      scanId: "s",
      scanContentHash: "h1",
      meta: { name: "x", description: "", proposed_grade: "V1", fa_info: "" },
      // Stale numbering must not leak through.
      holds: s.holds.map((h) => ({ ...h, seq_order: 7 })),
      paths: [],
    });
    expect(Object.fromEntries(p.holds.map((h) => [h.id, h.seq_order]))).toEqual(
      {
        f: null,
        a: 0,
        b: 1,
      },
    );
  });
});

describe("describeSaveFailure with feet", () => {
  it("maps foot_in_sequence and too_few_holds to plain language", () => {
    const v = describeSaveFailure({
      code: "validation",
      message: "",
      issues: [
        { code: "foot_in_sequence", message: "raw", holdId: "f" },
        { code: "too_few_holds", message: "raw" },
      ] as never,
    });
    expect(v.issues[0]!.message).toMatch(/Feet are optional single points/);
    expect(v.issues[1]!.message).toMatch(/do not count/);
    expect(v.holdIds).toEqual(["f"]);
  });
});

describe("holdsForSelection", () => {
  const h = (id: string, climb_id: string, type: Hold["type"]): Hold => ({
    id,
    climb_id,
    type,
    scan_content_hash: "h",
    position: [0, 0, 0],
    normal: [0, 1, 0],
    face_index: 0,
  });
  const all = [
    h("a1", "A", "hand"),
    h("af", "A", "foot"),
    h("bf", "B", "foot"),
    h("b1", "B", "hand"),
  ];
  it("shows only the selected climb's feet", () => {
    expect(holdsForSelection(all, "A").map((x) => x.id)).toEqual([
      "a1",
      "af",
      "b1",
    ]);
    expect(holdsForSelection(all, null).map((x) => x.id)).toEqual(["a1", "b1"]);
  });
});

function mockStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const s: DraftStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: vi.fn((k, v) => void data.set(k, v)),
    removeItem: vi.fn((k) => void data.delete(k)),
  };
  return { s, data };
}
const snap = () => {
  const st = run([place("a", "start"), place("f", "foot", 1)]);
  return { holds: st.holds, paths: st.paths, meta: { ...st.meta, name: "N" } };
};

describe("draft storage", () => {
  it("round-trips, keyed by scan id", () => {
    const { s, data } = mockStorage();
    expect(saveDraft(s, "scan1", "h1", snap(), 5)).toBe(true);
    expect(data.has(draftKey("scan1"))).toBe(true);
    const r = loadDraft(s, "scan1", "h1");
    expect(r).toMatchObject({ status: "restored", savedAt: 5 });
    expect(loadDraft(s, "other", "h1").status).toBe("none");
  });

  it("marks a draft for a different mesh stale instead of restoring it", () => {
    const { s } = mockStorage();
    saveDraft(s, "scan1", "old", snap());
    expect(loadDraft(s, "scan1", "new").status).toBe("stale");
  });

  it("ignores corrupt data and survives throwing storage", () => {
    const bad = mockStorage({ [draftKey("s")]: "{not json" });
    expect(loadDraft(bad.s, "s", "h").status).toBe("none");
    const wrong = mockStorage({ [draftKey("s")]: '{"v":1}' });
    expect(loadDraft(wrong.s, "s", "h").status).toBe("none");
    const boom: DraftStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadDraft(boom, "s", "h").status).toBe("none");
    expect(saveDraft(boom, "s", "h", snap())).toBe(false);
    expect(() => clearDraft(boom, "s")).not.toThrow();
    expect(saveDraft(null, "s", "h", snap())).toBe(false);
    expect(loadDraft(null, "s", "h").status).toBe("none");
  });

  it("an emptied editor removes the stored draft", () => {
    const { s, data } = mockStorage();
    saveDraft(s, "s", "h", snap());
    const empty = run([]);
    saveDraft(s, "s", "h", empty);
    expect(data.size).toBe(0);
  });

  it("browserStorage tolerates a throwing localStorage", () => {
    const spy = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    expect(browserStorage()).toBeNull();
    spy.mockRestore();
  });
});

describe("useDraft", () => {
  const store = () =>
    createEditorStore({ climbId: "draft", scanContentHash: "h1" });

  it("restores on mount with a notice, saves edits, and discards", () => {
    vi.useFakeTimers();
    const { s, data } = mockStorage();
    saveDraft(s, "scan1", "h1", snap());
    const st = store();
    const { result } = renderHook(() => useDraft(st, "scan1", "h1", s));
    expect(result.current.notice?.kind).toBe("restored");
    expect(st.getState().holds).toHaveLength(2);
    expect(st.getState().past).toEqual([]);

    act(() => {
      st.getState().setMeta({ name: "Renamed" });
      vi.advanceTimersByTime(600);
    });
    expect(
      loadDraft(s, "scan1", "h1").status === "restored" &&
        (
          loadDraft(s, "scan1", "h1") as {
            snapshot: { meta: { name: string } };
          }
        ).snapshot.meta.name,
    ).toBe("Renamed");

    act(() => result.current.discard());
    expect(st.getState().holds).toEqual([]);
    expect(data.size).toBe(0);
    expect(result.current.notice).toBeNull();
    vi.useRealTimers();
  });

  it("clear (after a successful save) removes the draft and stops writing", () => {
    vi.useFakeTimers();
    const { s, data } = mockStorage();
    const st = store();
    const { result } = renderHook(() => useDraft(st, "scan1", "h1", s));
    act(() => {
      st.getState().place(at(1), "hand");
      vi.advanceTimersByTime(600);
    });
    expect(data.size).toBe(1);
    act(() => {
      st.getState().place(at(2), "hand"); // pending write...
      result.current.clear(); // ...cancelled by the successful save
      vi.advanceTimersByTime(600);
    });
    expect(data.size).toBe(0);
    vi.useRealTimers();
  });

  it("flags a stale draft and does not restore it", () => {
    const { s } = mockStorage();
    saveDraft(s, "scan1", "old", snap());
    const st = store();
    const { result } = renderHook(() => useDraft(st, "scan1", "h1", s));
    expect(result.current.notice?.kind).toBe("stale");
    expect(st.getState().holds).toEqual([]);
  });

  it("does nothing without a scan id or storage", () => {
    const st = store();
    const { result } = renderHook(() => useDraft(st, undefined, "h1", null));
    expect(result.current.notice).toBeNull();
    const again = renderHook(() => useDraft(st, "s", "h1", null));
    act(() => st.getState().place(at(1), "hand"));
    expect(again.result.current.notice).toBeNull();
  });
});
