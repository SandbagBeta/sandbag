"use client";

import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
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
  /** Rendered at the top of the side panel (e.g. boulder title and metadata). */
  header?: ReactNode;
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
  header,
  children,
}: ClimbExplorerProps) {
  const [selectedClimbId, setSelected] = useState(() =>
    parseClimbParam(initialClimbId, climbs),
  );
  // Phones only: hiding the panel gives the viewer the whole screen.
  const [panelOpen, setPanelOpen] = useState(true);
  const panelId = useId();
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
        className={`w-full md:h-full md:flex-1 ${panelOpen ? "h-[60dvh] shrink-0" : "min-h-0 flex-1"}`}
        holds={holds}
        paths={paths}
        selectedClimbId={selectedClimbId}
        onSelectClimb={select}
      >
        {children}
      </ClimbViewer>
      <button
        type="button"
        aria-expanded={panelOpen}
        aria-controls={panelId}
        onClick={() => setPanelOpen((open) => !open)}
        className="border-t border-stone-200 px-4 py-2 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-600 md:hidden dark:border-stone-800"
      >
        {panelOpen ? "Hide details" : "Show details"}
      </button>
      <aside
        id={panelId}
        className={`flex-1 space-y-4 overflow-y-auto border-stone-200 p-4 md:block md:w-80 md:flex-none md:border-l dark:border-stone-800 ${panelOpen ? "" : "hidden"}`}
      >
        {header}
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
