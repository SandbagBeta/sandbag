"use client";

import { useState } from "react";
import {
  consensusGrade,
  sandbagGrades,
  sandbagLabel,
  totalVotes,
  type Distribution,
} from "@/lib/grades/consensus";
import { GradeHistogram } from "./GradeHistogram";
import { GradePicker } from "./GradePicker";

/** Applies a vote change (new vote, or switch from `prev`) to a distribution. */
export function applyVote(
  dist: Distribution,
  prev: string | null,
  next: string,
): Distribution {
  const out = { ...dist };
  if (prev) out[prev] = Math.max(0, (out[prev] ?? 0) - 1);
  out[next] = (out[next] ?? 0) + 1;
  return out;
}

/**
 * Self-contained grade-vote panel. Persistence is injected: `onVote` should
 * upsert the caller's single vote. Omit it (signed-out / read-only) to show
 * the distribution without the picker. If `onVote` rejects, the optimistic
 * change is rolled back.
 */
export function GradeVotes({
  proposedGrade,
  distribution,
  myVote = null,
  onVote,
}: {
  proposedGrade: string;
  distribution: Distribution;
  myVote?: string | null;
  onVote?: (grade: string) => Promise<void>;
}) {
  const [dist, setDist] = useState(distribution);
  const [mine, setMine] = useState(myVote);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const consensus = consensusGrade(dist);
  const badge = sandbagLabel(sandbagGrades(consensus, proposedGrade));
  const total = totalVotes(dist);

  async function vote(grade: string) {
    if (!onVote || grade === mine) return;
    const prevDist = dist;
    const prevMine = mine;
    setError(null);
    setDist(applyVote(dist, mine, grade));
    setMine(grade);
    setPending(true);
    try {
      await onVote(grade);
    } catch {
      setDist(prevDist);
      setMine(prevMine);
      setError("Could not save your vote. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Grade votes" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>
          Proposed <strong>{proposedGrade}</strong>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Consensus{" "}
          <strong>
            {consensus ?? (total === 0 ? "none yet" : "needs more votes")}
          </strong>
        </span>
        {badge && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
            {badge}
          </span>
        )}
      </div>
      <GradeHistogram distribution={dist} highlight={consensus} />
      {onVote && (
        <GradePicker value={mine} onChange={vote} disabled={pending} />
      )}
      <p role="status" className="text-sm text-red-600 dark:text-red-400">
        {error}
      </p>
    </section>
  );
}
