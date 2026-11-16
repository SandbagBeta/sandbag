import type { TrackerStep } from "@/lib/scan-report/tracker";

const DOT: Record<TrackerStep["state"], string> = {
  done: "bg-moss border-moss text-on-moss",
  current: "border-moss text-moss bg-surface",
  upcoming: "border-line text-muted bg-surface",
  problem: "border-sandstone bg-sandstone text-paper",
};

const WORD: Record<TrackerStep["state"], string> = {
  done: "done",
  current: "in progress",
  upcoming: "not yet",
  problem: "needs attention",
};

/** Four-step progress list. The state is spelled out for screen readers, not only coloured. */
export function StepTracker({ steps }: { steps: TrackerStep[] }) {
  return (
    <ol className="grid grid-cols-4 gap-1 text-center text-xs">
      {steps.map((s, i) => (
        <li
          key={s.id}
          data-state={s.state}
          aria-current={
            s.state === "current" || s.state === "problem" ? "step" : undefined
          }
          className="flex flex-col items-center gap-1"
        >
          <span
            aria-hidden="true"
            className={`flex size-6 items-center justify-center rounded-full border-2 text-[11px] font-bold ${DOT[s.state]}`}
          >
            {s.state === "done" ? "✓" : s.state === "problem" ? "!" : i + 1}
          </span>
          <span
            className={s.state === "upcoming" ? "text-muted" : "font-semibold"}
          >
            {s.label}
            <span className="sr-only"> ({WORD[s.state]})</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
