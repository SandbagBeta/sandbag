import type { HoldType } from "@/lib/types";
import type { EditorStore, HoldPlacement } from "./editorStore";

/**
 * What a click on the boulder does with the tool chosen at click time: adds a
 * hold of `tool` and returns the selection to show afterwards.
 *
 * The new hold is deliberately NOT selected. Choosing a tool (key 1-4 or a
 * toolbar button) retypes the selected hold, so a just-placed, auto-selected
 * hold would be silently retyped by the next tool change: Start, Hand, Hand,
 * Finish, Foot became Hand, Hand, Finish, Foot, Foot, and every retype also
 * cost an undo step.
 */
export function placeFromClick(
  store: Pick<EditorStore, "place">,
  at: HoldPlacement,
  tool: HoldType,
): string | null {
  store.place(at, tool);
  return null;
}
