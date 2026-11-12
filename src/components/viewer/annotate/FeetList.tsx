"use client";

import type { Hold } from "@/lib/types";
import { isFoot } from "./pathDraw";

export interface FeetListProps {
  holds: Hold[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

/** Optional foot holds: unordered single points, never part of the line. */
export function FeetList({
  holds,
  selectedId,
  onSelect,
  onRemove,
}: FeetListProps) {
  const feet = holds.filter(isFoot);
  return (
    <section aria-label="Feet (optional)" className="space-y-1">
      <h3 className="text-sm font-semibold">Feet (optional)</h3>
      {feet.length === 0 ? (
        <p className="text-sm">
          Choose the Foot type, then tap the boulder. Feet are not in the
          sequence or the line.
        </p>
      ) : (
        <ul className="space-y-1">
          {feet.map((h, i) => (
            <li
              key={h.id}
              className={`flex items-center gap-1 rounded px-1 text-sm ${h.id === selectedId ? "bg-amber-200 dark:bg-amber-900" : ""}`}
            >
              <button
                type="button"
                className="flex-1 py-1 text-left"
                aria-current={h.id === selectedId}
                onClick={() => onSelect(h.id)}
              >
                Foot {i + 1}
              </button>
              <button
                type="button"
                className="rounded px-2 py-1 hover:bg-stone-200 focus-visible:outline-2 dark:hover:bg-stone-800"
                aria-label={`Remove foot ${i + 1}`}
                onClick={() => onRemove(h.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
