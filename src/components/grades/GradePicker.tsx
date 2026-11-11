"use client";

import { V_GRADES } from "@/lib/grades/vScale";

/** V-scale picker: a native radio group, so arrow keys and screen readers work. */
export function GradePicker({
  value,
  onChange,
  disabled = false,
  name = "grade-vote",
}: {
  value: string | null;
  onChange: (grade: string) => void;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-sm font-medium">Your grade</legend>
      <div className="flex flex-wrap gap-1.5">
        {V_GRADES.map((g) => (
          <label key={g} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={g}
              checked={value === g}
              onChange={() => onChange(g)}
              className="peer sr-only"
            />
            <span className="inline-block min-w-11 rounded border border-zinc-300 px-2 py-1.5 text-center text-sm peer-checked:border-zinc-900 peer-checked:bg-zinc-900 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-disabled:opacity-50 dark:border-zinc-600 dark:peer-checked:border-zinc-100 dark:peer-checked:bg-zinc-100 dark:peer-checked:text-zinc-900">
              {g}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
