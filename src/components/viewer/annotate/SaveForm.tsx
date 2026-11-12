"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveClimb } from "@/app/annotate/actions";
import {
  buildSavePayload,
  describeSaveFailure,
  gradeError,
  type SaveFailureView,
} from "@/lib/annotations/savePayload";
import { V_GRADES } from "@/lib/grades/vScale";
import { signInPath } from "@/lib/auth/gating";
import type { ClimbPath, Hold } from "@/lib/types";
import type { ClimbMeta } from "./editorStore";

export interface SaveFormProps {
  scanId: string;
  scanContentHash: string;
  holds: Hold[];
  paths: ClimbPath[];
  meta: ClimbMeta;
  onMeta: (meta: Partial<ClimbMeta>) => void;
  /** Point at a hold the server flagged. */
  onSelect: (id: string) => void;
  /** Called after a successful save, before navigating (clears the draft). */
  onSaved?: () => void;
}

const field =
  "mt-1 block w-full rounded border border-stone-300 bg-transparent px-2 py-1 dark:border-stone-700";

/** Metadata fields and Save. The name field lives in the climb builder. */
export function SaveForm(p: SaveFormProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failure, setFailure] = useState<SaveFailureView | null>(null);
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
            scanContentHash: p.scanContentHash,
            meta: p.meta,
            holds: p.holds,
            paths: p.paths,
          }),
        );
        if (result.ok) {
          setFailure(null);
          p.onSaved?.();
          router.push(`/boulder/${p.scanId}?submitted=1`);
          return;
        }
        view = describeSaveFailure(result);
      } catch {
        view = describeSaveFailure({ code: "error", message: "" });
      }
      setFailure(view);
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
        {pending ? "Saving…" : "Save climb for review"}
      </button>
      <div role="alert">
        {failure && (
          <div className="space-y-1 text-red-700 dark:text-red-300">
            <p>{failure.message}</p>
            {failure.fields.name && <p>Name: {failure.fields.name}</p>}
            {failure.issues.length > 0 && (
              <ul className="list-disc pl-4">
                {failure.issues.map((i, k) => (
                  <li key={`${i.code}-${i.holdId ?? k}`}>
                    {i.message}
                    {i.holdId && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => p.onSelect(i.holdId!)}
                        >
                          Select hold
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {failure.action === "reload" && (
              <button
                type="button"
                className="underline"
                onClick={() => window.location.reload()}
              >
                Reload the scan
              </button>
            )}
            {failure.action === "sign-in" && (
              <a
                className="underline"
                href={signInPath(
                  window.location.pathname,
                  window.location.search,
                )}
              >
                Sign in
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
