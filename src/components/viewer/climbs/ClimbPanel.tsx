import Link from "next/link";
import type { Climb, ClimbPath, Hold } from "@/lib/types";
import { countHoldsByType } from "../holds/holdMath";
import {
  HOLD_STYLE,
  HOLD_TYPES,
  PATH_KINDS,
  PATH_STYLE,
} from "../holds/holdStyle";

/** `?climb=` value → a known climb id, or null. */
export function parseClimbParam(
  value: string | undefined | null,
  climbs: Pick<Climb, "id">[],
): string | null {
  return climbs.some((c) => c.id === value) ? (value as string) : null;
}

export interface ClimbListProps {
  climbs: Climb[];
  selectedClimbId: string | null;
  /** Called with null when the selected climb is pressed again. */
  onSelect: (climbId: string | null) => void;
}

/** Toggle buttons; the canvas-free way to pick a climb (keyboard + screen readers). */
export function ClimbList({
  climbs,
  selectedClimbId,
  onSelect,
}: ClimbListProps) {
  return (
    <section aria-labelledby="climb-list-heading">
      <h2 id="climb-list-heading" className="mb-2 text-sm font-semibold">
        Climbs
      </h2>
      {climbs.length === 0 ? (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          No climbs annotated on this scan yet.
        </p>
      ) : (
        <ul className="space-y-1">
          {climbs.map((c) => {
            const pressed = c.id === selectedClimbId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => onSelect(pressed ? null : c.id)}
                  className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                    pressed
                      ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
                      : "border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
                  }`}
                >
                  <span className="font-medium">{c.name}</span>{" "}
                  <span className="tabular-nums">{c.proposed_grade}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export interface ClimbInfoProps {
  climb: Climb | null;
  /** The selected climb's holds. */
  holds: Hold[];
  /** The selected climb's paths. */
  paths?: ClimbPath[];
}

export function ClimbInfo({ climb, holds, paths = [] }: ClimbInfoProps) {
  if (!climb) {
    return (
      <p
        aria-live="polite"
        className="text-sm text-stone-600 dark:text-stone-400"
      >
        Select a climb to highlight its holds and line.
      </p>
    );
  }
  const counts = countHoldsByType(holds);
  return (
    <section aria-live="polite" aria-labelledby="climb-info-heading">
      <h2 id="climb-info-heading" className="text-lg font-semibold">
        {climb.name}{" "}
        <span className="font-normal text-stone-600 dark:text-stone-400">
          {climb.proposed_grade}
        </span>
      </h2>
      <p className="mt-1 text-sm">{climb.description}</p>
      {climb.fa_info && (
        <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
          FA: {climb.fa_info}
        </p>
      )}
      <p className="mt-2 text-sm">
        <Link
          href={`/climb/${climb.id}`}
          className="underline hover:no-underline"
        >
          Grade votes
        </Link>
      </p>
      <h3 className="mt-3 text-sm font-semibold">Holds ({holds.length})</h3>
      <ul className="mt-1 grid grid-cols-2 gap-1 text-sm">
        {HOLD_TYPES.map((t) => (
          <li key={t} className="flex items-center gap-2">
            <span aria-hidden style={{ color: HOLD_STYLE[t].color }}>
              {HOLD_STYLE[t].glyph}
            </span>
            {HOLD_STYLE[t].label}: {counts[t]}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm">
        Marked:{" "}
        {PATH_KINDS.filter((k) => paths.some((p) => p.kind === k))
          .map((k) => PATH_STYLE[k].label.toLowerCase())
          .join(", ") || "no paths yet"}
      </p>
    </section>
  );
}
