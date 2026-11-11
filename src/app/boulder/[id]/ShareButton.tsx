"use client";

import { useState } from "react";

type Status = "idle" | "copied" | "failed";

/**
 * Shares the current URL (including `?climb=`, so a selected climb is kept).
 * Uses the native share sheet on phones, otherwise copies to the clipboard.
 */
export function ShareButton({ title }: { title: string }) {
  const [status, setStatus] = useState<Status>("idle");

  async function share() {
    const url = window.location.href;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch (err) {
      // The user closing the share sheet is not a failure.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatus("failed");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={share}
        className="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:border-stone-700 dark:hover:bg-stone-800"
      >
        Share link
      </button>
      <span
        aria-live="polite"
        className="text-xs text-stone-600 dark:text-stone-400"
      >
        {status === "copied" && "Link copied"}
        {status === "failed" && "Could not copy; use the address bar"}
      </span>
    </div>
  );
}
