"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveClimb } from "@/app/annotate/actions";
import {
  buildSavePayload,
  describeSaveFailure,
  gradeError,
  holdLabeler,
  type SaveFailureView,
} from "@/lib/annotations/savePayload";
import { V_GRADES } from "@/lib/grades/vScale";
import type { ClimbPath, Hold } from "@/lib/types";
import type { ClimbMeta } from "./editorStore";

export interface SaveFormProps {
  scanId: string;
  /** Set when editing a saved climb: Save replaces its holds and paths. */
  climbId?: string | null;
  scanContentHash: string;
  holds: Hold[];
  paths: ClimbPath[];
  meta: ClimbMeta;
  onMeta: (meta: Partial<ClimbMeta>) => void;
  /** Point at a hold the server flagged. */
  onSelect: (id: string) => void;
  /**
   * A save failed (or, with null, succeeded). The editor shows it in
   * {@link SaveFailureAlert} above the scrolling panel, where it can't be missed.
   */
  onFailure: (failure: SaveFailureView | null) => void;
  /** Called after a successful save, before navigating (clears the draft). */
  onSaved?: () => void;
}

const field =
  "mt-1 block w-full rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700";

/** Metadata fields and Save. The name field lives in the climb builder. */
export function SaveForm(p: SaveFormProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [gradeMsg, setGradeMsg] = useState<string | null>(null);

  const save = () => {
    const g = gradeError(p.meta.proposed_grade);
    setGradeMsg(g);
    if (g) return;
    start(async () => {
      let view: SaveFailureView;
      try {
        const result = await saveClimb(
          buildSavePayload({
            scanId: p.scanId,
            climbId: p.climbId,
            scanContentHash: p.scanContentHash,
            meta: p.meta,
            holds: p.holds,
            paths: p.paths,
          }),
        );
        if (result.ok) {
          p.onFailure(null);
          p.onSaved?.();
          router.push(
            `/boulder/${p.scanId}?${p.climbId ? "updated" : "submitted"}=1`,
          );
          return;
        }
        view = describeSaveFailure(result, holdLabeler(p.holds));
      } catch {
        view = describeSaveFailure({ code: "error", message: "" });
      }
      p.onFailure(view);
      if (view.holdIds[0]) p.onSelect(view.holdIds[0]);
    });
  };

  return (
    <div className="space-y-2 border-t border-stone-300 pt-2 text-sm dark:border-stone-700">
      <label className="block">
        Proposed grade
        <select
          value={p.meta.proposed_grade}
          onChange={(e) => p.onMeta({ proposed_grade: e.target.value })}
          aria-invalid={!!gradeMsg}
          className={field}
        >
          <option value="">Choose…</option>
          {V_GRADES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      {gradeMsg && <p className="text-red-700 dark:text-red-300">{gradeMsg}</p>}
      <label className="block">
        Description
        <textarea
          value={p.meta.description}
          onChange={(e) => p.onMeta({ description: e.target.value })}
          rows={2}
          maxLength={2000}
          className={field}
        />
      </label>
      <label className="block">
        First ascent (optional)
        <input
          value={p.meta.fa_info}
          onChange={(e) => p.onMeta({ fa_info: e.target.value })}
          maxLength={500}
          className={field}
        />
      </label>
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="w-full rounded bg-sky-700 px-3 py-1.5 text-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"
      >
        {pending
          ? "Saving…"
          : p.climbId
            ? "Save changes"
            : "Save climb for review"}
      </button>
    </div>
  );
}
