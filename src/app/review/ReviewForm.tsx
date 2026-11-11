"use client";

import Link from "next/link";
import { useActionState } from "react";
import { submitReviewAction, type ReviewFormState } from "./actions";

export interface ReviewFormProps {
  subjectId: string;
  subjectType?: "scan" | "climb";
  checklist: readonly { id: string; label: string }[];
}

const VERDICTS = [
  ["approve", "Approve"],
  ["request_changes", "Request changes"],
  ["reject", "Reject"],
] as const;

export function ReviewForm({
  subjectId,
  subjectType = "scan",
  checklist,
}: ReviewFormProps) {
  const [state, action, pending] = useActionState<ReviewFormState, FormData>(
    submitReviewAction,
    null,
  );
  const done = state?.ok === true;

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="subjectId" value={subjectId} />
      <input type="hidden" name="subjectType" value={subjectType} />
      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold">
          Checklist (required to approve)
        </legend>
        {checklist.map((c) => (
          <label key={c.id} className="flex items-center gap-2">
            <input type="checkbox" name="checked" value={c.id} />
            {c.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold">Verdict</legend>
        {VERDICTS.map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input type="radio" name="verdict" value={value} required />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">
          Reason (required unless approving; shown to the contributor)
        </span>
        <textarea
          name="reason"
          rows={4}
          className="rounded border border-stone-300 bg-white p-2 dark:border-stone-700 dark:bg-stone-900"
        />
      </label>
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending || done}
          className="rounded bg-stone-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
        >
          {pending ? "Submitting…" : "Submit review"}
        </button>
        <Link href="/review" className="underline">
          Back to queue
        </Link>
      </div>
      <p role="status" className="min-h-6">
        {state ? (state.ok ? state.message : state.error) : ""}
      </p>
    </form>
  );
}
