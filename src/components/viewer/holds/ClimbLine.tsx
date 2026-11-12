"use client";

import { useMemo } from "react";
import { Html, Line } from "@react-three/drei";
import type { ClimbPath, Hold } from "@/lib/types";
import {
  LINE_SURFACE_OFFSET,
  offsetPathPoints,
  pathMidpoint,
} from "./holdMath";
import { useMarkerScale } from "./markerSize";
import { PATH_STYLE } from "./holdStyle";

/** Topout/downclimb points farther than this from a hold are not lifted. */
const OFFSET_MAX_DIST = 0.3;

export interface ClimbLineProps {
  /** Any path kind: the line is solid; topout and downclimb are dashed + labelled. */
  path: ClimbPath;
  /** The same climb's holds, used to lift the path off the surface. */
  holds: Hold[];
}

export function ClimbLine({ path, holds }: ClimbLineProps) {
  const style = PATH_STYLE[path.kind];
  const isLine = path.kind === "line";
  const scale = useMarkerScale();
  const points = useMemo(
    () =>
      offsetPathPoints(
        path.points,
        holds,
        LINE_SURFACE_OFFSET * scale,
        isLine ? Infinity : OFFSET_MAX_DIST * scale,
      ),
    [path.points, holds, isLine, scale],
  );
  const labelAt = useMemo(
    () => (isLine ? null : pathMidpoint(points)),
    [isLine, points],
  );
  if (points.length < 2) return null;
  const dash = style.dash
    ? {
        dashed: true,
        dashSize: style.dash.size * scale,
        gapSize: style.dash.gap * scale,
      }
    : {};
  // Sparse points mean straight segments cut through convex rock, so draw a
  // faint pass that ignores depth under the solid pass: the whole path always
  // reads, and the visible stretches stand out.
  return (
    <group name={`climb-${path.kind}-${path.climb_id}`}>
      <Line
        points={points}
        color={style.color}
        lineWidth={3}
        transparent
        opacity={0.35}
        depthTest={false}
        depthWrite={false}
        renderOrder={1}
        raycast={() => null}
        {...dash}
      />
      <Line
        points={points}
        color={style.color}
        lineWidth={4}
        renderOrder={2}
        raycast={() => null}
        {...dash}
      />
      {labelAt && (
        // Decorative: the legend and the info panel carry the meaning in DOM.
        <Html position={labelAt} center zIndexRange={[10, 0]} aria-hidden>
          <span className="pointer-events-none rounded bg-stone-900/80 px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-white select-none">
            {style.label}
          </span>
        </Html>
      )}
    </group>
  );
}
