"use client";

import { useState, useTransition } from "react";
import { reportSaveFailure } from "@/app/annotate/actions";

export const NOTE_MAX = 1000;

/** A note of 1 to 1000 characters about one logged failure. */
export function ReportForm({ reference }: { reference: string }) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent)
    return (
      <p role="status" className="text-green-700 dark:text-green-400">
        Thanks. Your note was sent with reference {reference}. Your unsaved
        climb is still kept in your browser; you can go back and try saving
        again.
      </p>
    );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (note.trim().length === 0) {
      setError("Write a short note about what happened.");
      return;
    }
    setError(null);
    start(async () => {
      try {
        const r = await reportSaveFailure(reference, note);
        if (r.ok) setSent(true);
        else setError(r.message);
      } catch {
        setError("Couldn't send your note. Check your connection and retry.");
      }
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor="note" className="font-medium">
        What happened?
      </label>
      <textarea
        id="note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={6}
        maxLength={NOTE_MAX}
        required
        aria-describedby="note-count note-error"
        className="rounded-lg border border-stone-300 bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-900"
      />
      <p id="note-count" className="text-sm text-stone-500">
        {note.length}/{NOTE_MAX}
      </p>
      <p
        id="note-error"
        role="alert"
        className="text-sm text-red-700 dark:text-red-400"
      >
        {error}
      </p>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-stone-900 px-4 py-2 font-medium text-white hover:bg-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
      >
        {pending ? "Sending…" : "Send report"}
      </button>
    </form>
  );
}
