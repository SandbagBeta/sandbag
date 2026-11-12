"use client";

import { useActionState, useState } from "react";
import {
  formatNumber,
  parseScaleInput,
  realSize,
  scaleHelpText,
  type ScaleFormState,
} from "@/lib/review/scale";
import { setScaleAction } from "./actions";

/** The server's `reportPath` is relative; anything else is ignored. */
const REPORT_PREFIX = "/report-problem?ref=";

export interface ScaleControlProps {
  scanId: string;
  /** Longest side in the GLB frame (m) from QC; null if QC didn't record it. */
  longestSide: number | null;
  /** The scale currently saved on the scan. */
  currentFactor: number;
}

/**
 * Maintainer control for a pending scan's scale. Shows the measured size, the
 * resulting real size (live as you type) and plain-English help; failures show
 * the server's what/where/what-to-do/next-steps help.
 */
export function ScaleControl({
  scanId,
  longestSide,
  currentFactor,
}: ScaleControlProps) {
  const [text, setText] = useState(formatNumber(currentFactor));
  const [state, action, pending] = useActionState<ScaleFormState, FormData>(
    setScaleAction,
    null,
  );
  const parsed = parseScaleInput(text);
  const failure = state && !state.ok ? state.help : null;
  const reportPath =
    failure?.reportPath?.startsWith(REPORT_PREFIX) === true
      ? failure.reportPath
      : null;

  return (
    <section aria-labelledby="scale-heading" className="flex flex-col gap-2">
      <h2 id="scale-heading" className="text-xl font-semibold">
        Scale
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm">
        <dt>Measured longest side</dt>
        <dd>
          {longestSide === null
            ? "not recorded"
            : `${formatNumber(longestSide)} m (in the file)`}
        </dd>
        <dt>Saved scale</dt>
        <dd>{formatNumber(currentFactor)}</dd>
        {longestSide !== null && parsed.ok && (
          <>
            <dt>Real size with this scale</dt>
            <dd>
              <strong>
                {formatNumber(realSize(longestSide, parsed.factor))} m
              </strong>{" "}
              across
            </dd>
          </>
        )}
      </dl>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="scanId" value={scanId} />
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Scale factor</span>
          <input
            name="factor"
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby="scale-help"
            aria-invalid={!parsed.ok}
            className="w-32 rounded border border-stone-400 bg-white px-2 py-1 dark:border-stone-600 dark:bg-stone-900"
          />
        </label>
        <button
          type="submit"
          disabled={pending || !parsed.ok}
          className="rounded bg-stone-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
        >
          {pending ? "Saving..." : "Set scale"}
        </button>
      </form>
      <p id="scale-help" className="text-sm text-stone-600 dark:text-stone-400">
        {scaleHelpText(longestSide)}
      </p>
      {!parsed.ok && text.trim() !== "" && (
        <p className="text-sm text-red-700 dark:text-red-300">{parsed.error}</p>
      )}
      <div role="status">
        {state?.ok && <p>{state.message} The preview above uses it now.</p>}
      </div>
      <div role="alert">
        {failure && (
          <div className="space-y-1.5 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
            <p className="text-xs font-semibold tracking-wide uppercase">
              {failure.stageLabel}
            </p>
            <p>{failure.whatHappened}</p>
            {failure.whatYouCanDo.length > 0 && (
              <ul className="list-disc pl-4">
                {failure.whatYouCanDo.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
            {failure.nextSteps.map((t) => (
              <p key={t}>{t}</p>
            ))}
            {!failure.userFixable && failure.reference && (
              <p>
                Reference: <strong>{failure.reference}</strong>
                {reportPath && (
                  <>
                    {" "}
                    <a
                      className="underline"
                      href={reportPath}
                      target="_blank"
                      rel="noopener"
                    >
                      Report this problem (opens in a new tab)
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
