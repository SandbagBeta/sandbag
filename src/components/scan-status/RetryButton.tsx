"use client";

import { useActionState } from "react";

export function RetryButton({
  scanId,
  action,
}: {
  scanId: string;
  action: (
    prev: { error: string } | null,
    formData: FormData,
  ) => Promise<{ error: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="scanId" value={scanId} />
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-lg bg-stone-900 px-4 py-2 font-medium text-white hover:bg-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
      >
        {pending ? "Starting…" : "Upload a new version"}
      </button>
      <p role="status" className="text-sm text-red-700 dark:text-red-400">
        {state?.error}
      </p>
    </form>
  );
}
