"use client";

import { useEffect } from "react";
import type { HoldType } from "@/lib/types";
import { HOLD_STYLE, HOLD_TYPES } from "../holds/holdStyle";

export interface AnnotateControlsProps {
  activeType: HoldType;
  onTypeChange: (type: HoldType) => void;
  /** Id of the selected hold, if any; 1-4 also retype it, Delete removes it. */
  selectedId: string | null;
  holdCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onRetype: (id: string, type: HoldType) => void;
  onDelete: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Floating hold-type picker plus the editor keyboard shortcuts. */
export function AnnotateControls(p: AnnotateControlsProps) {
  const { onTypeChange, onRetype, onDelete, onUndo, onRedo, selectedId } = p;

  useEffect(() => {
    const choose = (type: HoldType) => {
      onTypeChange(type);
      if (selectedId) onRetype(selectedId, type);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (key === "z") (e.shiftKey ? onRedo : onUndo)();
        else if (key === "y") onRedo();
        else return;
        e.preventDefault();
        return;
      }
      const type = HOLD_TYPES[Number(e.key) - 1];
      if (type) choose(type);
      else if ((key === "delete" || key === "backspace") && selectedId) {
        e.preventDefault();
        onDelete(selectedId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onTypeChange, onRetype, onDelete, onUndo, onRedo, selectedId]);

  const btn =
    "rounded px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-40";
  return (
    <div
      role="toolbar"
      aria-label="Annotation tools"
      className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-stone-300 bg-white/90 p-1 text-stone-900 shadow dark:border-stone-700 dark:bg-stone-900/90 dark:text-stone-100"
    >
      {HOLD_TYPES.map((type, i) => (
        <button
          key={type}
          type="button"
          aria-pressed={p.activeType === type}
          aria-keyshortcuts={String(i + 1)}
          onClick={() => {
            onTypeChange(type);
            if (selectedId) onRetype(selectedId, type);
          }}
          className={`${btn} ${p.activeType === type ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900" : "hover:bg-stone-200 dark:hover:bg-stone-800"}`}
        >
          <span aria-hidden>{HOLD_STYLE[type].glyph}</span>{" "}
          {HOLD_STYLE[type].label}
          <kbd className="ml-1 text-xs opacity-60">{i + 1}</kbd>
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-stone-300 dark:bg-stone-700" />
      <button
        type="button"
        className={btn}
        disabled={!p.canUndo}
        onClick={onUndo}
      >
        Undo
      </button>
      <button
        type="button"
        className={btn}
        disabled={!p.canRedo}
        onClick={onRedo}
      >
        Redo
      </button>
      <button
        type="button"
        className={btn}
        disabled={!selectedId}
        onClick={() => selectedId && onDelete(selectedId)}
      >
        Delete
      </button>
      <span className="px-2 text-xs" aria-live="polite">
        {p.holdCount} {p.holdCount === 1 ? "hold" : "holds"}
      </span>
    </div>
  );
}
