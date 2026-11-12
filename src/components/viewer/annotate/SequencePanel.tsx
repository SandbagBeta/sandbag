"use client";

import type { ReactNode } from "react";
import type { MeshSurface } from "@/lib/annotations";
import type { Hold } from "@/lib/types";
import type { DrawKind, DrawState } from "./pathDraw";
import type { ClimbMeta } from "./editorStore";
import { SequenceList } from "./SequenceList";
import { ValidationPanel } from "./ValidationPanel";

export interface SequencePanelProps {
  holds: Hold[];
  meta: ClimbMeta;
  scanContentHash: string;
  mesh: MeshSurface | null;
  selectedId: string | null;
  draw: DrawState;
  hasPath: (kind: DrawKind) => boolean;
  onSelect: (id: string) => void;
  onReorder: (id: string, toIndex: number) => void;
  onName: (name: string) => void;
  onDraw: (kind: DrawKind) => void;
  onClearPath: (kind: DrawKind) => void;
  /** Rendered below validation (the save form). */
  children?: ReactNode;
}

const KINDS: DrawKind[] = ["topout", "downclimb"];

/** Side panel: name, sequence, path drawing and live validation. */
export function SequencePanel(p: SequencePanelProps) {
  const btn =
    "rounded border border-stone-300 px-2 py-1 text-sm focus-visible:outline-2 dark:border-stone-700";
  return (
    <aside
      aria-label="Climb builder"
      className="absolute top-4 right-4 z-10 w-64 space-y-3 rounded-lg border border-stone-300 bg-white/90 p-3 text-stone-900 shadow dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-100"
    >
      <label className="block text-sm">
        Name
        <input
          value={p.meta.name}
          onChange={(e) => p.onName(e.target.value)}
          className="mt-1 block w-full rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
        />
      </label>
      <SequenceList
        holds={p.holds}
        selectedId={p.selectedId}
        onSelect={p.onSelect}
        onReorder={p.onReorder}
      />
      <div className="space-y-1">
        {KINDS.map((kind) => (
          <div key={kind} className="flex gap-1">
            <button
              type="button"
              className={btn}
              aria-pressed={p.draw.kind === kind}
              onClick={() => p.onDraw(kind)}
            >
              Draw {kind}
            </button>
            {p.hasPath(kind) && (
              <button
                type="button"
                className={btn}
                onClick={() => p.onClearPath(kind)}
              >
                Clear
              </button>
            )}
          </div>
        ))}
        {p.draw.kind && (
          <p role="status" className="text-xs">
            Drawing {p.draw.kind}: {p.draw.points.length} points. Click the
            boulder to add, Enter to finish, Escape to cancel.
          </p>
        )}
      </div>
      <ValidationPanel
        holds={p.holds}
        meta={p.meta}
        scanContentHash={p.scanContentHash}
        mesh={p.mesh}
      />
      {p.children}
    </aside>
  );
}
