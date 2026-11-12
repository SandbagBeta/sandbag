import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Hold } from "@/lib/types";
import { editorReducer, initialEditorState } from "./editorStore";
import { drawReducer, IDLE, sequenceLine } from "./pathDraw";
import { SequenceList } from "./SequenceList";
import { ValidationPanel } from "./ValidationPanel";

const hold = (id: string, seq_order: number): Hold => ({
  id,
  climb_id: "c1",
  scan_content_hash: "abc",
  position: [seq_order, 0, 0],
  normal: [0, 0, 1],
  face_index: 0,
  type: "hand",
  seq_order,
});

describe("sequence reorder", () => {
  it("renumbers seq_order 0..n-1 and keeps click order by default", () => {
    let s = initialEditorState({ climbId: "c1", scanContentHash: "abc" });
    const at = {
      position: [0, 0, 0] as [number, number, number],
      normal: [0, 0, 1] as [number, number, number],
      face_index: 0,
    };
    for (const id of ["a", "b", "c"])
      s = editorReducer(s, { type: "place", id, at, holdType: "hand" });
    expect(s.holds.map((h) => h.seq_order)).toEqual([0, 1, 2]);
    s = editorReducer(s, { type: "reorder", id: "a", toIndex: 2 });
    expect(s.holds.map((h) => [h.id, h.seq_order])).toEqual([
      ["b", 0],
      ["c", 1],
      ["a", 2],
    ]);
  });

  it("list buttons call onReorder and bound the ends", () => {
    const onReorder = vi.fn();
    render(
      <SequenceList
        holds={[hold("a", 0), hold("b", 1)]}
        selectedId={null}
        onSelect={vi.fn()}
        onReorder={onReorder}
      />,
    );
    expect(
      (screen.getByLabelText("Move hold 1 up") as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText("Move hold 1 down"));
    expect(onReorder).toHaveBeenCalledWith("a", 1);
  });

  it("derives the line in sequence order", () => {
    const line = sequenceLine([hold("b", 1), hold("a", 0)], "c1");
    expect(line?.kind).toBe("line");
    expect(line?.points).toEqual([
      [0, 0, 0],
      [1, 0, 0],
    ]);
    expect(sequenceLine([hold("a", 0)], "c1")).toBeNull();
  });
});

describe("drawReducer", () => {
  it("appends only while drawing; finish and cancel go idle", () => {
    expect(drawReducer(IDLE, { type: "append", point: [1, 1, 1] })).toBe(IDLE);
    let s = drawReducer(IDLE, { type: "start", kind: "topout" });
    s = drawReducer(s, { type: "append", point: [1, 1, 1] });
    s = drawReducer(s, { type: "append", point: [2, 2, 2] });
    expect(s.points).toHaveLength(2);
    expect(drawReducer(s, { type: "finish" })).toEqual(IDLE);
    expect(drawReducer(s, { type: "cancel" })).toEqual(IDLE);
  });
});

describe("ValidationPanel", () => {
  it("renders validator issues inline", () => {
    render(
      <ValidationPanel
        holds={[hold("a", 0)]}
        meta={{ name: "", description: "", proposed_grade: "", fa_info: "" }}
        scanContentHash="abc"
        mesh={{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }}
      />,
    );
    expect(screen.getByText(/name is required/i)).toBeTruthy();
    expect(screen.getByRole("list")).toBeTruthy();
  });
});
