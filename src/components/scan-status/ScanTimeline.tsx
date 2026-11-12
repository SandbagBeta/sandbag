import type { TimelineStep } from "@/lib/scan-report/format";

export function ScanTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((s, i) => (
        <li
          key={s.id}
          aria-current={i === steps.length - 1 ? "step" : undefined}
        >
          <span
            className={i === steps.length - 1 ? "font-semibold" : undefined}
          >
            {s.label}
          </span>{" "}
          <time
            dateTime={s.at}
            className="text-sm text-stone-600 dark:text-stone-400"
          >
            {new Date(s.at).toISOString().replace("T", " ").slice(0, 16)} UTC
          </time>
        </li>
      ))}
    </ol>
  );
}
