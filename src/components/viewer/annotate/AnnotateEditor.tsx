"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { Climb, ClimbPath, Hold } from "@/lib/types";
import { ClimbExplorer } from "../climbs/ClimbExplorer";

const AnnotateViewer = dynamic(
  () => import("./AnnotateViewer").then((m) => m.AnnotateViewer),
  { ssr: false },
);

/** Annotation needs a mouse and room for the toolbar. */
const DESKTOP = "(min-width: 768px) and (pointer: fine)";

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export interface AnnotateEditorProps {
  src: string;
  label: string;
  scanContentHash: string;
  /** Read-only fallback data for small or touch screens. */
  climbs: Climb[];
  holds: Hold[];
  paths: ClimbPath[];
  children?: ReactNode;
}

/** Hold editor on desktop; the read-only climb explorer everywhere else. */
export function AnnotateEditor({
  src,
  label,
  scanContentHash,
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
        label={label}
        climbs={climbs}
        holds={holds}
        paths={paths}
      >
        Hold annotation is available on desktop; this is the read-only view.
        {children}
      </ClimbExplorer>
    );
  }
  return (
    <AnnotateViewer
      src={src}
      label={label}
      scanContentHash={scanContentHash}
      className="h-dvh w-full"
    >
      {children}
    </AnnotateViewer>
  );
}
