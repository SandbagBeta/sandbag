"use client";

import { useMemo, type ReactNode } from "react";
import type { ClimbPath, Hold } from "@/lib/types";
import { BoulderViewer } from "../BoulderViewer";
import { ClimbLine } from "./ClimbLine";
import { HoldMarkers } from "./HoldMarkers";

export interface ClimbViewerProps {
  src: string;
  label: string;
  className?: string;
  /** Every hold on the scan (all climbs); markers render in world space. */
  holds: Hold[];
  paths: ClimbPath[];
  selectedClimbId: string | null;
  onSelectClimb: (climbId: string) => void;
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
            holds={holds}
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
