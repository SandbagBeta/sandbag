# Grade votes UI (#24)

Self-contained components; no data fetching.

- `GradeVotes` - panel: proposed grade, consensus, "Sandbagged by N grades" badge, histogram, picker.
  - Props: `proposedGrade`, `distribution` (`{ V4: 3, ... }`), `myVote?`, `onVote?(grade) => Promise<void | VoteOutcome>`.
  - Omit `onVote` for a read-only view. `onVote` rejection rolls back the optimistic update.
  - Client component: `onVote` must be created in a client component (functions can't cross the server/client boundary unless they are Server Actions).
- `GradePicker` - radio group VB..V17 (keyboard + screen-reader friendly).
- `GradeHistogram` - list with bars; counts are text, so it reads without sight.

Logic lives in `src/lib/grades/` (`consensus.ts`, `vScale.ts`), unit-tested:

- Consensus = mode; ties go to the grade nearest the median, then the lower grade. Needs >= 3 votes (`MIN_VOTES_FOR_CONSENSUS`).
- Badge shows only when consensus is harder than the proposed grade.

## Wiring

- Page: `src/app/climb/[id]` (published climbs only; linked from the boulder page climb panel).
- Distribution: RPC `climb_grade_distribution` via `loadDistribution` (`src/lib/grades/votes.ts`; `rowsToDistribution` maps rows to `Distribution`).
- Votes: server action `castGradeVote` saves the caller's single `grade_votes` row (RLS: own row, published climbs only). It updates `grade` first and inserts if there is no row, because an upsert also writes `climb_id`/`user_id`, which `authenticated` may not update. It returns a `VoteOutcome`: `{ ok: false, help }` carries a `FailureHelp` (`src/lib/grades/voteFailure.ts`); a server error is logged with an `SB-` reference. Signed-out users get the read-only view plus a sign-in link.
