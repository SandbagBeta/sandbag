import { act, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { useStore } from "zustand";
import type { HoldType } from "@/lib/types";
import { validateClimbAnnotations } from "@/lib/annotations";
import { plainIssue } from "@/lib/annotations/savePayload";
import { AnnotateControls } from "./AnnotateControls";
import { loadDraft } from "./draftStorage";
import { createEditorStore, type HoldPlacement } from "./editorStore";
import { isFoot, sequenceHolds } from "./pathDraw";
import { placeFromClick } from "./placement";

const at = (n: number): HoldPlacement => ({
  position: [n, 0, 0],
  normal: [0, 0, 1],
  face_index: 0,
});

/** The viewer's wiring: toolbar + selection + click placement, no canvas. */
function setup() {
  const store = createEditorStore({ climbId: "c", scanContentHash: "h" });
  let click: (n: number) => void = () => {};
  function Harness() {
    const [tool, setTool] = useState<HoldType>("hand");
    const [sel, setSel] = useState<string | null>(null);
    const s = useStore(store, (x) => x);
    click = (n) => setSel(placeFromClick(store.getState(), at(n), tool));
    return (
      <AnnotateControls
        activeType={tool}
        onTypeChange={setTool}
        selectedId={sel}
        holdCount={s.holds.length}
        canUndo={s.past.length > 0}
        canRedo={s.future.length > 0}
        onRetype={s.retype}
        onDelete={s.remove}
        onUndo={s.undo}
        onRedo={s.redo}
      />
    );
  }
  render(<Harness />);
  return {
    store,
    key: (k: string) => fireEvent.keyDown(window, { key: k }),
    click: (n: number) => act(() => click(n)),
  };
}

const TYPES = ["start", "hand", "hand", "finish", "foot"];

function placeClimb(e: ReturnType<typeof setup>) {
  [
    ["1", 0],
    ["2", 1],
    ["2", 2],
    ["4", 3],
    ["3", 4],
  ].forEach(([k, n]) => {
    e.key(k as string);
    e.click(n as number);
  });
}

describe("placing with the tool chosen at click time", () => {
  it("start, hand, hand, finish, foot keep their types, order and feet", () => {
    const e = setup();
    placeClimb(e);
    const { holds } = e.store.getState();
    expect(holds.map((h) => h.type)).toEqual(TYPES);
    expect(sequenceHolds(holds).map((h) => [h.type, h.seq_order])).toEqual([
      ["start", 0],
      ["hand", 1],
      ["hand", 2],
      ["finish", 3],
    ]);
    expect(holds.filter(isFoot).map((h) => h.seq_order)).toEqual([null]);
  });

  it("a Start-tool hold satisfies the start-hold count", () => {
    const e = setup();
    placeClimb(e);
    const issues = validateClimbAnnotations(
      { name: "x", holds: e.store.getState().holds.filter((h) => !isFoot(h)) },
      {
        scanContentHash: "h",
        mesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
        existingNames: [],
      },
    ).map((i) => plainIssue(i).message);
    expect(issues.join()).not.toMatch(/start holds/);
  });

  it("one undo per placement: five undos empty the climb, redo restores it", () => {
    const e = setup();
    placeClimb(e);
    expect(e.store.getState().past).toHaveLength(5);
    for (let i = 0; i < 5; i++) e.store.getState().undo();
    expect(e.store.getState().holds).toEqual([]);
    for (let i = 0; i < 5; i++) e.store.getState().redo();
    expect(e.store.getState().holds.map((h) => h.type)).toEqual(TYPES);
  });

  it("a stored draft with an unknown hold type is ignored, not restored", () => {
    const e = setup();
    placeClimb(e);
    const d = JSON.stringify({
      v: 1,
      scanContentHash: "h",
      savedAt: 1,
      holds: [{ id: "a", type: "bogus", position: [0, 0, 0] }],
      paths: [],
      meta: { name: "", description: "", proposed_grade: "", fa_info: "" },
    });
    const storage = { getItem: () => d, setItem() {}, removeItem() {} };
    expect(loadDraft(storage, "s", "h").status).toBe("none");
  });

  it("choosing a tool with nothing selected retypes nothing", () => {
    const e = setup();
    e.key("2");
    e.click(0);
    e.key("1");
    expect(e.store.getState().holds[0]!.type).toBe("hand");
  });
});
