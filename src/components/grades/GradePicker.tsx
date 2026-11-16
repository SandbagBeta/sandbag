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
            <span className="border-line bg-surface peer-checked:border-moss peer-checked:bg-moss peer-checked:text-on-moss inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-2 text-sm peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--focus)] peer-disabled:opacity-50">
              {g}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
