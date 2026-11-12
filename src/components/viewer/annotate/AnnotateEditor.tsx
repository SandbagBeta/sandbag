"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { Climb, ClimbPath, Hold } from "@/lib/types";
import { ClimbExplorer } from "../climbs/ClimbExplorer";

const AnnotateViewer = dynamic(
  () => import("./AnnotateViewer").then((m) => m.AnnotateViewer),
  { ssr: false },
);

/** Placement works by tap; only very narrow screens fall back to read-only. */
const DESKTOP = "(min-width: 360px)";

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export interface AnnotateEditorProps {
  src: string;
  label: string;
  scanContentHash: string;
  /** Enables saving (issue #22). */
  scanId?: string;
  /** The scan's reviewed scale (`scans.scale_factor`); default 1. */
  scale?: number;
  /** Read-only fallback data for small or touch screens. */
  climbs: Climb[];
  holds: Hold[];
  paths: ClimbPath[];
  children?: ReactNode;
}

/** Hold editor (desktop and phones); read-only explorer below 360px. */
export function AnnotateEditor({
  src,
  label,
  scanContentHash,
  scanId,
  scale,
  climbs,
  holds,
  paths,
  children,
}: AnnotateEditorProps) {
  const desktop = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP).matches,
    () => false,
  );
  if (!desktop) {
    return (
      <ClimbExplorer
        src={src}
        scale={scale}
        label={label}
        climbs={climbs}
        holds={holds}
        paths={paths}
      >
        Hold annotation needs a wider screen; this is the read-only view.
        {children}
      </ClimbExplorer>
    );
  }
  return (
    <AnnotateViewer
      src={src}
      scale={scale}
      label={label}
      scanContentHash={scanContentHash}
      scanId={scanId}
      className="h-dvh w-full"
    >
      {children}
    </AnnotateViewer>
  );
}
