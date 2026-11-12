"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import type { ClimbPath, Hold } from "@/lib/types";

// WebGL only; keeps three.js out of the initial chunk.
const ClimbViewer = dynamic(
  () =>
    import("@/components/viewer/holds/ClimbViewer").then((m) => m.ClimbViewer),
  { ssr: false },
);

/** Read-only preview of one pending climb's proposed holds and line. */
export function ReviewClimbViewer({
  src,
  climbId,
  scale,
  holds,
  paths,
  children,
}: {
  src: string;
  climbId: string;
  scale?: number;
  holds: Hold[];
  paths: ClimbPath[];
  children?: ReactNode;
}) {
  return (
    <ClimbViewer
      src={src}
      label="Proposed holds and line"
      className="h-96 w-full rounded border border-stone-300 dark:border-stone-700"
      scale={scale}
      holds={holds}
      paths={paths}
      selectedClimbId={climbId}
      onSelectClimb={() => {}}
    >
      {children}
    </ClimbViewer>
  );
}
