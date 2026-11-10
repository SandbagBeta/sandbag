"use client";

import { useActionState } from "react";
import { HANDLE_MAX, HANDLE_MIN } from "@/lib/auth/handle";
import { updateHandle, type HandleFormState } from "./actions";

export function HandleForm({ handle }: { handle: string }) {
  const [state, action, pending] = useActionState<HandleFormState, FormData>(
    updateHandle,
    null,
  );

  return (
    <form action={action} className="flex flex-col gap-2">
      <label htmlFor="handle" className="font-medium">
        Handle
      </label>
      <div className="flex gap-2">
        <input
          id="handle"
          name="handle"
          defaultValue={handle}
          required
          minLength={HANDLE_MIN}
          maxLength={HANDLE_MAX}
          pattern="[a-z0-9_]+"
          autoComplete="username"
          aria-describedby="handle-help handle-status"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-900"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-stone-900 px-4 py-2 font-medium text-white hover:bg-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300 dark:focus-visible:outline-stone-100"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <p id="handle-help" className="text-sm text-stone-500">
        {HANDLE_MIN}-{HANDLE_MAX} characters: lowercase letters, digits and
        underscores. Shown publicly as attribution on your contributions.
      </p>
      <p
        id="handle-status"
        role="status"
        className={
          state?.ok === false
            ? "text-sm text-red-700 dark:text-red-400"
            : "text-sm text-green-700 dark:text-green-400"
        }
      >
        {state?.message}
      </p>
    </form>
  );
}
