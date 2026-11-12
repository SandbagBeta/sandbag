"use client";

import type { DraftNotice as Notice } from "./useDraft";

/** Says a browser-kept draft was found, and lets the user throw it away. */
export function DraftNotice({
  notice,
  onDiscard,
  onDismiss,
}: {
  notice: Notice;
  onDiscard: () => void;
  onDismiss: () => void;
}) {
  if (!notice) return null;
  const when = new Date(notice.savedAt).toLocaleString();
  const btn =
    "rounded border border-stone-400 px-2 py-1 text-sm focus-visible:outline-2 dark:border-stone-600";
  return (
    <div
      role="status"
      className="absolute top-4 left-4 z-10 max-w-xs space-y-2 rounded-lg border border-amber-400 bg-amber-50/95 p-3 text-sm text-stone-900 shadow dark:border-amber-700 dark:bg-stone-900/95 dark:text-stone-100"
    >
      <p>
        {notice.kind === "restored"
          ? `Restored your unsaved draft from ${when}. It is kept in this browser until you save.`
          : `Found an unsaved draft from ${when}, but the scan's mesh has changed since, so its holds no longer match and were not restored.`}
      </p>
      <div className="flex gap-2">
        <button type="button" className={btn} onClick={onDiscard}>
          Discard draft
        </button>
        {notice.kind === "restored" && (
          <button type="button" className={btn} onClick={onDismiss}>
            Keep editing
          </button>
        )}
      </div>
    </div>
  );
}
