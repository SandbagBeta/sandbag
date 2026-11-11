# Grade votes UI (#24)

Self-contained components; no data fetching.

- `GradeVotes` - panel: proposed grade, consensus, "Sandbagged by N grades" badge, histogram, picker.
  - Props: `proposedGrade`, `distribution` (`{ V4: 3, ... }`), `myVote?`, `onVote?(grade) => Promise<void>`.
  - Omit `onVote` for a read-only view. `onVote` rejection rolls back the optimistic update.
  - Client component: `onVote` must be created in a client component (functions can't cross the server/client boundary unless they are Server Actions).
- `GradePicker` - radio group VB..V17 (keyboard + screen-reader friendly).
- `GradeHistogram` - list with bars; counts are text, so it reads without sight.

Logic lives in `src/lib/grades/` (`consensus.ts`, `vScale.ts`), unit-tested:

- Consensus = mode; ties go to the grade nearest the median, then the lower grade. Needs >= 3 votes (`MIN_VOTES_FOR_CONSENSUS`).
- Badge shows only when consensus is harder than the proposed grade.

## Not wired yet

Persistence is blocked on backend: RLS lets a user upsert only their own `grade_votes` row (`grade_votes_own`), but other users' votes are private, so the distribution needs an aggregate (SECURITY DEFINER function or view) that does not exist. There is also no climb page to mount the panel on.
