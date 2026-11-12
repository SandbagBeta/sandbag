"use client";

import { useState } from "react";
import type { Hold } from "@/lib/types";
import { HOLD_STYLE } from "../holds/holdStyle";
import { sequenceHolds } from "./pathDraw";

export interface SequenceListProps {
  holds: Hold[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (id: string, toIndex: number) => void;
}

/** Keyboard-accessible hold order (feet excluded): up/down buttons, or drag a row. */
export function SequenceList({
  holds,
  selectedId,
  onSelect,
  onReorder,
}: SequenceListProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const ordered = sequenceHolds(holds);
  const btn =
    "rounded px-1.5 text-sm hover:bg-stone-200 focus-visible:outline-2 disabled:opacity-30 dark:hover:bg-stone-800";
  if (!ordered.length)
    return (
      <p className="text-sm">
        Tap or click the boulder to add holds. Feet are optional and listed
        separately.
      </p>
    );
  return (
    <ol aria-label="Hold sequence" className="space-y-1">
      {ordered.map((h, i) => (
        <li
          key={h.id}
          draggable
          onDragStart={() => setDragId(h.id)}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragId && dragId !== h.id) onReorder(dragId, i);
            setDragId(null);
          }}
          className={`flex items-center gap-1 rounded px-1 text-sm ${h.id === selectedId ? "bg-amber-200 dark:bg-amber-900" : ""}`}
        >
          <button
            type="button"
            className="flex-1 text-left"
            aria-current={h.id === selectedId}
            onClick={() => onSelect(h.id)}
          >
            {i + 1}. {HOLD_STYLE[h.type].label}
          </button>
          <button
            type="button"
            className={btn}
            disabled={i === 0}
            aria-label={`Move hold ${i + 1} up`}
            onClick={() => onReorder(h.id, i - 1)}
          >
            ↑
          </button>
          <button
            type="button"
            className={btn}
            disabled={i === ordered.length - 1}
            aria-label={`Move hold ${i + 1} down`}
            onClick={() => onReorder(h.id, i + 1)}
          >
            ↓
          </button>
        </li>
      ))}
    </ol>
  );
}
