"use client";

import { useMemo, type ReactNode } from "react";
import type { ClimbPath, Hold } from "@/lib/types";
import { BoulderViewer } from "../BoulderViewer";
import { ClimbLine } from "./ClimbLine";
import { HoldMarkers } from "./HoldMarkers";
import { holdsForSelection } from "./holdMath";

export interface ClimbViewerProps {
  src: string;
  label: string;
  className?: string;
  /** Every hold on the scan (all climbs); markers render in world space. */
  holds: Hold[];
  paths: ClimbPath[];
  selectedClimbId: string | null;
  onSelectClimb: (climbId: string) => void;
  /** The scan's reviewed scale (`scans.scale_factor`); default 1. */
  scale?: number;
  children?: ReactNode;
}

/**
 * `BoulderViewer` plus hold markers and the selected climb's paths (line,
 * topout, downclimb). Lazy-load
 * this module (`next/dynamic`, `ssr: false`) so three.js stays out of the
 * page's initial chunk.
 */
export function ClimbViewer({
  holds,
  paths,
  selectedClimbId,
  onSelectClimb,
  ...viewer
}: ClimbViewerProps) {
  const climbPaths = useMemo(
    () => paths.filter((p) => p.climb_id === selectedClimbId),
    [paths, selectedClimbId],
  );
  // Feet belong to one climb only: show the selected climb's feet, nobody else's.
  const visibleHolds = useMemo(
    () => holdsForSelection(holds, selectedClimbId),
    [holds, selectedClimbId],
  );
  const lineHolds = useMemo(
    () => holds.filter((h) => h.climb_id === selectedClimbId),
    [holds, selectedClimbId],
  );
  return (
    <BoulderViewer
      {...viewer}
      scene={
        <>
          <HoldMarkers
            holds={visibleHolds}
            selectedClimbId={selectedClimbId}
            onSelectClimb={onSelectClimb}
          />
          {climbPaths.map((p) => (
            <ClimbLine key={p.id} path={p} holds={lineHolds} />
          ))}
        </>
      }
    />
  );
}
