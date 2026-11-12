"use client";

import type { ReactNode } from "react";
import type { MeshSurface } from "@/lib/annotations";
import type { Hold } from "@/lib/types";
import type { DrawKind, DrawState } from "./pathDraw";
import type { ClimbMeta } from "./editorStore";
import { useState } from "react";
import { MarkerSizeSlider } from "../holds/markerSize";
import { FeetList } from "./FeetList";
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
  onRemove: (id: string) => void;
  onName: (name: string) => void;
  onDraw: (kind: DrawKind) => void;
  onClearPath: (kind: DrawKind) => void;
  /** Rendered under the live validation, above the scroll (save failures). */
  alerts?: ReactNode;
  /** Rendered at the end of the scrolling body (the save form). */
  children?: ReactNode;
}

const KINDS: DrawKind[] = ["topout", "downclimb"];

/** Side panel: name, sequence, path drawing and live validation. */
export function SequencePanel(p: SequencePanelProps) {
  const [open, setOpen] = useState(false);
  const btn =
    "rounded border border-stone-300 px-2 py-1 text-sm focus-visible:outline-2 dark:border-stone-700";
  return (
    <aside
      aria-label="Climb builder"
      className="absolute top-4 right-4 z-10 w-64 max-w-[calc(100%-2rem)] rounded-lg border border-stone-300 bg-white/90 p-3 text-stone-900 shadow dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-100"
    >
      {/* Phones: the panel collapses so the boulder stays tappable. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="climb-builder-body"
        onClick={() => setOpen((o) => !o)}
        className={`${btn} w-full md:hidden`}
      >
        {open ? "Hide climb builder" : "Climb builder"}
      </button>
      {/* Outside the scrolling body so problems are never buried below it. */}
      <div
        className={`max-h-[30dvh] space-y-2 overflow-y-auto max-md:mt-2 ${open ? "" : "max-md:hidden"} md:mb-3`}
      >
        <ValidationPanel
          holds={p.holds}
          meta={p.meta}
          scanContentHash={p.scanContentHash}
          mesh={p.mesh}
        />
        {p.alerts}
      </div>
      <div
        id="climb-builder-body"
        className={`max-h-[50dvh] space-y-3 overflow-y-auto max-md:mt-2 md:block md:max-h-[calc(100dvh-16rem)] ${open ? "" : "max-md:hidden"}`}
      >
        <label className="block text-sm">
          Name
          <input
            value={p.meta.name}
            onChange={(e) => p.onName(e.target.value)}
            className="mt-1 block w-full rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700"
          />
        </label>
        <MarkerSizeSlider />
        <SequenceList
          holds={p.holds}
          selectedId={p.selectedId}
          onSelect={p.onSelect}
          onReorder={p.onReorder}
        />
        <FeetList
          holds={p.holds}
          selectedId={p.selectedId}
          onSelect={p.onSelect}
          onRemove={p.onRemove}
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
        {p.children}
      </div>
    </aside>
  );
}
