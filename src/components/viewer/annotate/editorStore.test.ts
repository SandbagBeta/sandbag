import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  editorReducer,
  HISTORY_LIMIT,
  initialEditorState,
  type EditorAction,
  type HoldPlacement,
} from "./editorStore";

const at = (n: number): HoldPlacement => ({
  position: [n, 0, 0],
  normal: [0, 0, 1],
  face_index: n,
});
const init = () =>
  initialEditorState({ climbId: "c1", scanContentHash: "abc123" });
const run = (actions: EditorAction[], s = init()) =>
  actions.reduce(editorReducer, s);
const place = (id: string, n = 0): EditorAction => ({
  type: "place",
  id,
  at: at(n),
  holdType: "hand",
});

describe("editorReducer", () => {
  it("place adds a hold carrying climb id, content hash and order", () => {
    const s = run([place("a"), place("b", 1)]);
    expect(s.holds.map((h) => h.id)).toEqual(["a", "b"]);
    expect(s.holds[1]).toMatchObject({
      climb_id: "c1",
      scan_content_hash: "abc123",
      face_index: 1,
      type: "hand",
      seq_order: 1,
    });
  });

  it("move updates geometry only; unknown id is a no-op with no history", () => {
    const s = run([place("a"), { type: "move", id: "a", to: at(9) }]);
    expect(s.holds[0]).toMatchObject({ face_index: 9, type: "hand" });
    const same = editorReducer(s, { type: "move", id: "nope", to: at(1) });
    expect(same).toBe(s);
  });

  it("retype changes type", () => {
    const s = run([place("a"), { type: "retype", id: "a", holdType: "start" }]);
    expect(s.holds[0]!.type).toBe("start");
  });

  it("delete removes and renumbers", () => {
    const s = run([
      place("a"),
      place("b"),
      place("c"),
      { type: "delete", id: "a" },
    ]);
    expect(s.holds.map((h) => [h.id, h.seq_order])).toEqual([
      ["b", 0],
      ["c", 1],
    ]);
  });

  it("reorder moves and renumbers, clamping the target", () => {
    const s = run([
      place("a"),
      place("b"),
      place("c"),
      { type: "reorder", id: "c", toIndex: 0 },
    ]);
    expect(s.holds.map((h) => [h.id, h.seq_order])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
    const end = editorReducer(s, { type: "reorder", id: "c", toIndex: 99 });
    expect(end.holds.map((h) => h.id)).toEqual(["a", "b", "c"]);
  });

  it("setPath replaces the path of a kind and removes it when empty", () => {
    const pts: [number, number, number][] = [
      [0, 0, 0],
      [1, 1, 1],
    ];
    let s = run([{ type: "setPath", id: "p1", kind: "line", points: pts }]);
    expect(s.paths).toEqual([
      { id: "p1", climb_id: "c1", kind: "line", points: pts },
    ]);
    s = editorReducer(s, {
      type: "setPath",
      id: "p1",
      kind: "line",
      points: [[2, 2, 2]],
    });
    expect(s.paths).toHaveLength(1);
    expect(s.paths[0]!.points).toEqual([[2, 2, 2]]);
    s = editorReducer(s, {
      type: "setPath",
      id: "p1",
      kind: "line",
      points: [],
    });
    expect(s.paths).toEqual([]);
  });

  it("setMeta merges", () => {
    const s = run([
      { type: "setMeta", meta: { name: "Warmup" } },
      { type: "setMeta", meta: { proposed_grade: "V2" } },
    ]);
    expect(s.meta).toEqual({
      name: "Warmup",
      description: "",
      proposed_grade: "V2",
      fa_info: "",
    });
  });

  it("undo and redo walk the history; a new edit clears redo", () => {
    let s = run([place("a"), place("b")]);
    s = editorReducer(s, { type: "undo" });
    expect(s.holds.map((h) => h.id)).toEqual(["a"]);
    s = editorReducer(s, { type: "redo" });
    expect(s.holds.map((h) => h.id)).toEqual(["a", "b"]);
    s = run([{ type: "undo" }, { type: "undo" }], s);
    expect(s.holds).toEqual([]);
    expect(editorReducer(s, { type: "undo" })).toBe(s);
    s = run([{ type: "redo" }, place("z")], s);
    expect(s.future).toEqual([]);
    expect(editorReducer(s, { type: "redo" })).toBe(s);
  });

  it("undo restores deleted holds and metadata", () => {
    let s = run([place("a"), { type: "setMeta", meta: { name: "X" } }]);
    s = run([{ type: "delete", id: "a" }, { type: "undo" }], s);
    expect(s.holds.map((h) => h.id)).toEqual(["a"]);
    s = editorReducer(s, { type: "undo" });
    expect(s.meta.name).toBe("");
  });

  it("caps history at 100 snapshots", () => {
    const actions = Array.from({ length: HISTORY_LIMIT + 20 }, (_, i) =>
      place(`h${i}`, i),
    );
    const s = run(actions);
    expect(s.past).toHaveLength(HISTORY_LIMIT);
    const back = run(Array(HISTORY_LIMIT + 5).fill({ type: "undo" }), s);
    expect(back.holds).toHaveLength(20);
    expect(back.future).toHaveLength(HISTORY_LIMIT);
  });
});

describe("createEditorStore", () => {
  it("assigns uuid hold ids and supports undo/redo", () => {
    const store = createEditorStore({
      climbId: "c1",
      scanContentHash: "abc123",
    });
    const id = store.getState().place(at(3), "start");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.getState().holds[0]).toMatchObject({
      id,
      scan_content_hash: "abc123",
      type: "start",
    });
    store.getState().undo();
    expect(store.getState().holds).toEqual([]);
    store.getState().redo();
    expect(store.getState().holds).toHaveLength(1);
  });
});
