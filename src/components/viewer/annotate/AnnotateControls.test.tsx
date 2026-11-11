import { fireEvent, render, screen } from "@testing-library/react";
import {
  AnnotateControls,
  type AnnotateControlsProps,
} from "./AnnotateControls";

function setup(over: Partial<AnnotateControlsProps> = {}) {
  const props: AnnotateControlsProps = {
    activeType: "hand",
    onTypeChange: vi.fn(),
    selectedId: null,
    holdCount: 0,
    canUndo: true,
    canRedo: true,
    onRetype: vi.fn(),
    onDelete: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...over,
  };
  render(<AnnotateControls {...props} />);
  return props;
}

describe("AnnotateControls", () => {
  it("marks the active type and picks via click", () => {
    const p = setup();
    expect(
      screen.getByRole("button", { name: /Hand/ }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Finish/ }));
    expect(p.onTypeChange).toHaveBeenCalledWith("finish");
  });

  it("keys 1-4 choose a type and retype the selected hold", () => {
    const p = setup({ selectedId: "h1" });
    fireEvent.keyDown(window, { key: "1" });
    expect(p.onTypeChange).toHaveBeenCalledWith("start");
    expect(p.onRetype).toHaveBeenCalledWith("h1", "start");
    fireEvent.keyDown(window, { key: "3" });
    expect(p.onTypeChange).toHaveBeenLastCalledWith("foot");
  });

  it("Delete and Backspace remove only a selected hold", () => {
    const none = setup();
    fireEvent.keyDown(window, { key: "Delete" });
    expect(none.onDelete).not.toHaveBeenCalled();
    const p = setup({ selectedId: "h1" });
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(p.onDelete).toHaveBeenCalledWith("h1");
  });

  it("Ctrl+Z undoes, Ctrl+Shift+Z redoes", () => {
    const p = setup();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(p.onUndo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(p.onRedo).toHaveBeenCalledTimes(1);
  });

  it("ignores shortcuts while typing in a field", () => {
    const p = setup();
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "2" });
    fireEvent.keyDown(input, { key: "z", ctrlKey: true });
    expect(p.onTypeChange).not.toHaveBeenCalled();
    expect(p.onUndo).not.toHaveBeenCalled();
    input.remove();
  });
});
