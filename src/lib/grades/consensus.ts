import { gradeRank } from "./vScale";

/** Below this many votes we show the distribution but no consensus/badge. */
export const MIN_VOTES_FOR_CONSENSUS = 3;

export type Distribution = Record<string, number>;

/** Tallies grades; ignores non-V-scale strings. */
export function tally(grades: readonly string[]): Distribution {
  const out: Distribution = {};
  for (const g of grades) {
    if (gradeRank(g) === null) continue;
    const key = g.trim().toUpperCase();
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export function totalVotes(dist: Distribution): number {
  return Object.values(dist).reduce((a, b) => a + b, 0);
}

/**
 * Consensus = the most-voted grade. Ties resolve to the tied grade nearest the
 * median vote, then to the lower grade (don't over-claim sandbagging).
 * Returns null under `minVotes` or with no valid votes.
 */
export function consensusGrade(
  dist: Distribution,
  minVotes = MIN_VOTES_FOR_CONSENSUS,
): string | null {
  const entries: { g: string; n: number; r: number }[] = [];
  for (const [g, n] of Object.entries(dist)) {
    const r = gradeRank(g);
    if (r !== null && n > 0) entries.push({ g, n, r });
  }
  const total = entries.reduce((a, e) => a + e.n, 0);
  if (total === 0 || total < minVotes) return null;

  const sorted = [...entries].sort((a, b) => a.r - b.r);
  let seen = 0;
  let median = sorted[0]?.r ?? 0;
  for (const e of sorted) {
    seen += e.n;
    if (seen >= total / 2) {
      median = e.r;
      break;
    }
  }
  const top = Math.max(...entries.map((e) => e.n));
  const tied = entries.filter((e) => e.n === top);
  tied.sort(
    (a, b) => Math.abs(a.r - median) - Math.abs(b.r - median) || a.r - b.r,
  );
  return tied[0]?.g ?? null;
}

/**
 * Whole grades by which consensus is harder than the proposed/guidebook grade;
 * 0 when equal, easier, unknown, or no consensus (we only badge sandbagging).
 */
export function sandbagGrades(
  consensus: string | null,
  baseline: string,
): number {
  if (!consensus) return 0;
  const c = gradeRank(consensus);
  const b = gradeRank(baseline);
  if (c === null || b === null) return 0;
  return Math.max(0, c - b);
}

export function sandbagLabel(n: number): string | null {
  if (n <= 0) return null;
  return `Sandbagged by ${n} ${n === 1 ? "grade" : "grades"}`;
}
