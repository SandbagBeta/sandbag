"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { Climb, ClimbPath, Hold } from "@/lib/types";
import { ClimbInfo, ClimbList, parseClimbParam } from "./ClimbPanel";

// WebGL only, and keeps three.js out of the initial chunk.
const ClimbViewer = dynamic(
  () => import("../holds/ClimbViewer").then((m) => m.ClimbViewer),
  { ssr: false },
);

export interface ClimbExplorerProps {
  src: string;
  label: string;
  climbs: Climb[];
  holds: Hold[];
  paths: ClimbPath[];
  /** Raw `?climb=` value; ignored unless it names one of `climbs`. */
  initialClimbId?: string;
  /** Visually hidden text alternative for the canvas. */
  children?: ReactNode;
}

/**
 * Viewer + climb list + info panel. Selection lives in the URL (`?climb=<id>`)
 * so it is shareable; replaceState avoids a server round-trip per click.
 */
export function ClimbExplorer({
  src,
  label,
  climbs,
  holds,
  paths,
  initialClimbId,
  children,
}: ClimbExplorerProps) {
  const [selectedClimbId, setSelected] = useState(() =>
    parseClimbParam(initialClimbId, climbs),
  );
  const select = useCallback((id: string | null) => {
    setSelected(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("climb", id);
    else url.searchParams.delete("climb");
    window.history.replaceState(null, "", url);
  }, []);

  const climb = climbs.find((c) => c.id === selectedClimbId) ?? null;
  const climbHolds = useMemo(
    () => holds.filter((h) => h.climb_id === selectedClimbId),
    [holds, selectedClimbId],
  );

  return (
    <div className="flex h-dvh flex-col bg-white text-stone-900 md:flex-row dark:bg-stone-950 dark:text-stone-100">
      <ClimbViewer
        src={src}
        label={label}
        className="h-[60dvh] w-full shrink-0 md:h-full md:flex-1"
        holds={holds}
        paths={paths}
        selectedClimbId={selectedClimbId}
        onSelectClimb={select}
      >
        {children}
      </ClimbViewer>
      <aside className="flex-1 space-y-4 overflow-y-auto border-t border-stone-200 p-4 md:w-80 md:flex-none md:border-t-0 md:border-l dark:border-stone-800">
        <ClimbList
          climbs={climbs}
          selectedClimbId={selectedClimbId}
          onSelect={select}
        />
        <ClimbInfo climb={climb} holds={climbHolds} />
      </aside>
    </div>
  );
}
