import { gradeRank } from "@/lib/grades/vScale";
import type { Distribution } from "@/lib/grades/consensus";

/**
 * Vote histogram over the grades that have votes. Rendered as a list so the
 * counts are readable without seeing the bars.
 */
export function GradeHistogram({
  distribution,
  highlight,
}: {
  distribution: Distribution;
  /** Grade to emphasise (the consensus). */
  highlight?: string | null;
}) {
  const rows = Object.entries(distribution)
    .filter(([g, n]) => n > 0 && gradeRank(g) !== null)
    .sort(([a], [b]) => (gradeRank(a) ?? 0) - (gradeRank(b) ?? 0));
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">No grade votes yet.</p>;
  }
  const max = Math.max(...rows.map(([, n]) => n));
  return (
    <ul aria-label="Grade vote distribution" className="space-y-1">
      {rows.map(([g, n]) => (
        <li key={g} className="flex items-center gap-2 text-sm">
          <span className="w-9 shrink-0 font-medium">{g}</span>
          <span
            aria-hidden="true"
            className={`h-3 rounded ${g === highlight ? "bg-amber-500" : "bg-zinc-400 dark:bg-zinc-500"}`}
            style={{ width: `${(n / max) * 100}%`, minWidth: "0.25rem" }}
          />
          <span className="text-zinc-600 tabular-nums dark:text-zinc-400">
            {n} {n === 1 ? "vote" : "votes"}
          </span>
        </li>
      ))}
    </ul>
  );
}
