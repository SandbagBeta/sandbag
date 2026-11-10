"use client";

import { useMemo } from "react";
import { Line } from "@react-three/drei";
import type { ClimbPath, Hold } from "@/lib/types";
import { offsetPathPoints } from "./holdMath";
import { CLIMB_LINE_COLOR } from "./holdStyle";

export interface ClimbLineProps {
  /** The climb's `kind: "line"` path; topout/downclimb are drawn elsewhere (#11). */
  path: ClimbPath;
  /** The same climb's holds, used to lift the line off the surface. */
  holds: Hold[];
}

export function ClimbLine({ path, holds }: ClimbLineProps) {
  const points = useMemo(
    () => offsetPathPoints(path.points, holds),
    [path.points, holds],
  );
  if (points.length < 2) return null;
  // Sparse points mean straight segments cut through convex rock, so draw a
  // faint pass that ignores depth under the solid pass: the whole line always
  // reads, and the visible stretches stand out.
  return (
    <group name={`climb-line-${path.climb_id}`}>
      <Line
        points={points}
        color={CLIMB_LINE_COLOR}
        lineWidth={3}
        transparent
        opacity={0.35}
        depthTest={false}
        depthWrite={false}
        renderOrder={1}
        raycast={() => null}
      />
      <Line
        points={points}
        color={CLIMB_LINE_COLOR}
        lineWidth={4}
        renderOrder={2}
        raycast={() => null}
      />
    </group>
  );
}
