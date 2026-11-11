"use client";

import { useMemo } from "react";
import { validateClimbAnnotations, type MeshSurface } from "@/lib/annotations";
import type { Hold } from "@/lib/types";
import type { ClimbMeta } from "./editorStore";

export interface ValidationPanelProps {
  holds: Hold[];
  meta: ClimbMeta;
  scanContentHash: string;
  mesh: MeshSurface | null;
}

/** Runs the shared validator client-side and lists issues inline. */
export function ValidationPanel({
  holds,
  meta,
  scanContentHash,
  mesh,
}: ValidationPanelProps) {
  const issues = useMemo(
    () =>
      mesh
        ? validateClimbAnnotations(
            { name: meta.name, holds },
            { scanContentHash, mesh, existingNames: [] },
          )
        : [],
    [holds, meta.name, scanContentHash, mesh],
  );
  return (
    <section aria-label="Validation" aria-live="polite" className="text-sm">
      {issues.length === 0 ? (
        <p>No issues.</p>
      ) : (
        <ul className="list-disc pl-4 text-red-700 dark:text-red-300">
          {issues.map((i, k) => (
            <li key={`${i.code}-${i.holdId ?? k}`}>{i.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
