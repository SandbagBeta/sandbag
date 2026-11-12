"use client";

import { useMemo } from "react";
import { validateClimbAnnotations, type MeshSurface } from "@/lib/annotations";
import {
  gradeError,
  holdLabeler,
  plainIssue,
} from "@/lib/annotations/savePayload";
import type { Hold } from "@/lib/types";
import type { ClimbMeta } from "./editorStore";
import { isFoot } from "./pathDraw";

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
  const issues = useMemo(() => {
    if (!mesh) return [];
    const label = holdLabeler(holds);
    return validateClimbAnnotations(
      // Feet are optional: only start/hand/finish holds count (min 3)
      // and take part in the sequence.
      { name: meta.name, holds: holds.filter((h) => !isFoot(h)) },
      { scanContentHash, mesh, existingNames: [] },
    ).map((i) => plainIssue(i, label));
  }, [holds, meta.name, scanContentHash, mesh]);
  // The server-side validator does not know the grade, but Save demands one.
  const gradeMsg = gradeError(meta.proposed_grade);
  return (
    <section aria-label="Validation" aria-live="polite" className="text-sm">
      {issues.length === 0 && !gradeMsg ? (
        <p>No issues.</p>
      ) : (
        <ul className="list-disc pl-4 text-red-700 dark:text-red-300">
          {issues.map((i, k) => (
            <li key={`${i.code}-${i.holdId ?? k}`}>{i.message}</li>
          ))}
          {gradeMsg && <li>{gradeMsg}</li>}
        </ul>
      )}
    </section>
  );
}
