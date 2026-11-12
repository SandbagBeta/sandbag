import type { ClimbPath, Hold, PathKind, Vec3 } from "@/lib/types";

/** Kinds the user draws by clicking; `line` is derived from the sequence. */
export type DrawKind = Exclude<PathKind, "line">;

export interface DrawState {
  kind: DrawKind | null;
  points: Vec3[];
}

export type DrawAction =
  | { type: "start"; kind: DrawKind }
  | { type: "append"; point: Vec3 }
  | { type: "finish" }
  | { type: "cancel" };

export const IDLE: DrawState = { kind: null, points: [] };

/**
 * Pure state for "draw path" mode: each click appends, finish/cancel leave
 * the mode. The caller commits `points` (via the editor store) before
 * dispatching finish; cancel discards them.
 */
export function drawReducer(s: DrawState, a: DrawAction): DrawState {
  switch (a.type) {
    case "start":
      return { kind: a.kind, points: [] };
    case "append":
      return s.kind ? { ...s, points: [...s.points, a.point] } : s;
    case "finish":
    case "cancel":
      return IDLE;
  }
}

/** Feet are optional, unordered single points: not in the line or sequence. */
export const isFoot = (h: Hold): boolean => h.type === "foot";

/** The sequence: non-foot holds in seq_order (array order breaks ties). */
export const sequenceHolds = (holds: Hold[]): Hold[] =>
  holds
    .filter((h) => !isFoot(h))
    .sort((a, b) => (a.seq_order ?? 0) - (b.seq_order ?? 0));

/** The climbing line: non-foot hold positions in sequence order (derived, never stored). */
export function sequenceLine(holds: Hold[], climbId: string): ClimbPath | null {
  const sorted = sequenceHolds(holds);
  if (sorted.length < 2) return null;
  return {
    id: "derived-line",
    climb_id: climbId,
    kind: "line",
    points: sorted.map((h) => h.position),
  };
}
