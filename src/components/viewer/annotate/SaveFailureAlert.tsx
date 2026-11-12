"use client";

import { signInPath } from "@/lib/auth/gating";
import type { SaveFailureView } from "@/lib/annotations/savePayload";

/** The server's `reportPath` is relative; anything else is ignored. */
const REPORT_PREFIX = "/report-problem?ref=";

/**
 * Why a save failed, in the server's words (`help`): which step failed, what
 * happened, what to do next. Failures the user can't fix show their reference
 * and a link to report them. Lives above the scrolling part of the panel so it
 * is always in view.
 */
export function SaveFailureAlert({
  failure,
  onSelect,
}: {
  failure: SaveFailureView | null;
  onSelect: (id: string) => void;
}) {
  if (!failure) return <div role="alert" />;
  const { help } = failure;
  const reportPath =
    help.reportPath?.startsWith(REPORT_PREFIX) === true
      ? help.reportPath
      : null;
  return (
    <div role="alert">
      <div className="space-y-1.5 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
        <p className="text-xs font-semibold tracking-wide uppercase">
          {help.stageLabel}
        </p>
        <p>{help.whatHappened}</p>
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
                      onClick={() => onSelect(i.holdId!)}
                    >
                      Select hold
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {failure.issues.length === 0 && help.whatYouCanDo.length > 0 && (
          <ul className="list-disc pl-4">
            {help.whatYouCanDo.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
        {help.nextSteps.map((t) => (
          <p key={t}>{t}</p>
        ))}
        <p>
          Your holds and lines are still here, and a copy is kept in this
          browser, so reloading or leaving the page won&apos;t lose them.
        </p>
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
            href={signInPath(window.location.pathname, window.location.search)}
          >
            Sign in
          </a>
        )}
        {!help.userFixable && help.reference && (
          <p>
            Reference: <strong>{help.reference}</strong>
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
    </div>
  );
}
