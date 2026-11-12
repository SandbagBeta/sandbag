import { create } from "zustand";
import type { ClimbPath, Hold, HoldType, PathKind, Vec3 } from "@/lib/types";
import { isFoot, sequenceHolds } from "./pathDraw";

/**
 * Annotation editor state (issue #21): holds, paths and climb meta with
 * undo/redo. The reducer is pure (ids are supplied by the action creators);
 * zustand only wraps it for the viewer UI.
 */

export const HISTORY_LIMIT = 100;

export interface ClimbMeta {
  name: string;
  description: string;
  proposed_grade: string;
  fa_info: string;
}

export interface Snapshot {
  holds: Hold[];
  paths: ClimbPath[];
  meta: ClimbMeta;
}

export interface EditorState extends Snapshot {
  climbId: string;
  scanContentHash: string;
  past: Snapshot[];
  future: Snapshot[];
}

export interface HoldPlacement {
  position: Vec3;
  normal: Vec3;
  face_index: number;
}

export type EditorAction =
  | { type: "place"; id: string; at: HoldPlacement; holdType: HoldType }
  | { type: "move"; id: string; to: HoldPlacement }
  | { type: "retype"; id: string; holdType: HoldType }
  | { type: "delete"; id: string }
  | { type: "reorder"; id: string; toIndex: number }
  | { type: "setPath"; id: string; kind: PathKind; points: Vec3[] }
  | { type: "setMeta"; meta: Partial<ClimbMeta> }
  /** Replaces the whole edit (draft restore/discard); clears history. */
  | { type: "restore"; snapshot: Snapshot }
  | { type: "undo" }
  | { type: "redo" };

export interface EditorInit {
  climbId: string;
  scanContentHash: string;
  holds?: Hold[];
  paths?: ClimbPath[];
  meta?: Partial<ClimbMeta>;
}

export function initialEditorState(init: EditorInit): EditorState {
  return {
    climbId: init.climbId,
    scanContentHash: init.scanContentHash,
    holds: init.holds ?? [],
    paths: init.paths ?? [],
    meta: {
      name: "",
      description: "",
      proposed_grade: "",
      fa_info: "",
      ...init.meta,
    },
    past: [],
    future: [],
  };
}

const snapshot = (s: EditorState): Snapshot => ({
  holds: s.holds,
  paths: s.paths,
  meta: s.meta,
});

/**
 * Sequence numbers run 0..n-1 over the non-foot holds in array order; feet are
 * unordered single points and carry seq_order null.
 */
const renumber = (holds: Hold[]): Hold[] => {
  let n = 0;
  return holds.map((h) => {
    const want = isFoot(h) ? null : n++;
    return (h.seq_order ?? null) === want ? h : { ...h, seq_order: want };
  });
};

/** The edited snapshot, or null when the action is a no-op (unknown id etc). */
function apply(s: EditorState, a: EditorAction): Snapshot | null {
  const has = (id: string) => s.holds.some((h) => h.id === id);
  const base = snapshot(s);
  switch (a.type) {
    case "place":
      return {
        ...base,
        holds: [
          ...s.holds,
          {
            id: a.id,
            climb_id: s.climbId,
            scan_content_hash: s.scanContentHash,
            ...a.at,
            type: a.holdType,
            seq_order:
              a.holdType === "foot" ? null : sequenceHolds(s.holds).length,
          },
        ],
      };
    case "move":
      if (!has(a.id)) return null;
      return {
        ...base,
        holds: s.holds.map((h) => (h.id === a.id ? { ...h, ...a.to } : h)),
      };
    case "retype":
      if (!has(a.id)) return null;
      return {
        ...base,
        holds: renumber(
          s.holds.map((h) => (h.id === a.id ? { ...h, type: a.holdType } : h)),
        ),
      };
    case "delete":
      if (!has(a.id)) return null;
      return {
        ...base,
        holds: renumber(s.holds.filter((h) => h.id !== a.id)),
      };
    case "reorder": {
      // Indexes address the sequence (non-foot holds); feet never move in it.
      const seq = sequenceHolds(s.holds);
      const from = seq.findIndex((h) => h.id === a.id);
      const to = Math.max(0, Math.min(seq.length - 1, a.toIndex));
      if (from < 0 || to === from) return null;
      seq.splice(to, 0, seq.splice(from, 1)[0]!);
      return { ...base, holds: renumber([...seq, ...s.holds.filter(isFoot)]) };
    }
    case "setPath": {
      const rest = s.paths.filter((p) => p.kind !== a.kind);
      const path: ClimbPath = {
        id: a.id,
        climb_id: s.climbId,
        kind: a.kind,
        points: a.points,
      };
      return { ...base, paths: a.points.length ? [...rest, path] : rest };
    }
    case "setMeta":
      return { ...base, meta: { ...s.meta, ...a.meta } };
    default:
      return null;
  }
}

export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  if (action.type === "restore")
    return { ...state, ...action.snapshot, past: [], future: [] };
  if (action.type === "undo") {
    const prev = state.past[state.past.length - 1];
    if (!prev) return state;
    return {
      ...state,
      ...prev,
      past: state.past.slice(0, -1),
      future: [snapshot(state), ...state.future].slice(0, HISTORY_LIMIT),
    };
  }
  if (action.type === "redo") {
    const [next, ...future] = state.future;
    if (!next) return state;
    return {
      ...state,
      ...next,
      past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
      future,
    };
  }
  const next = apply(state, action);
  if (!next) return state;
  return {
    ...state,
    ...next,
    past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT),
    future: [],
  };
}

export interface EditorStore extends EditorState {
  dispatch: (action: EditorAction) => void;
  /** Places a hold and returns its new id. */
  place: (at: HoldPlacement, holdType: HoldType) => string;
  move: (id: string, to: HoldPlacement) => void;
  retype: (id: string, holdType: HoldType) => void;
  remove: (id: string) => void;
  reorder: (id: string, toIndex: number) => void;
  /** Replaces the path of `kind`; empty points removes it. */
  setPath: (kind: PathKind, points: Vec3[]) => void;
  setMeta: (meta: Partial<ClimbMeta>) => void;
  undo: () => void;
  redo: () => void;
  /** Replaces holds, paths and meta (draft restore/discard); clears history. */
  restore: (snapshot: Snapshot) => void;
}

/** One store per edit session; `init` carries the scan's content hash. */
export const createEditorStore = (init: EditorInit) =>
  create<EditorStore>((set, get) => {
    const dispatch = (a: EditorAction) => set((s) => editorReducer(s, a));
    return {
      ...initialEditorState(init),
      dispatch,
      place: (at, holdType) => {
        const id = crypto.randomUUID();
        dispatch({ type: "place", id, at, holdType });
        return id;
      },
      move: (id, to) => dispatch({ type: "move", id, to }),
      retype: (id, holdType) => dispatch({ type: "retype", id, holdType }),
      remove: (id) => dispatch({ type: "delete", id }),
      reorder: (id, toIndex) => dispatch({ type: "reorder", id, toIndex }),
      setPath: (kind, points) => {
        const id = get().paths.find((p) => p.kind === kind)?.id;
        dispatch({
          type: "setPath",
          id: id ?? crypto.randomUUID(),
          kind,
          points,
        });
      },
      setMeta: (meta) => dispatch({ type: "setMeta", meta }),
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" }),
      restore: (snapshot) => dispatch({ type: "restore", snapshot }),
    };
  });
