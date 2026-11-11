"use client";

import { GradeVotes } from "@/components/grades/GradeVotes";
import type { Distribution } from "@/lib/grades/consensus";
import { castGradeVote } from "./actions";

/** Binds the server action to the panel; `canVote` false gives a read-only view. */
export function VotePanel({
  climbId,
  proposedGrade,
  distribution,
  myVote,
  canVote,
}: {
  climbId: string;
  proposedGrade: string;
  distribution: Distribution;
  myVote: string | null;
  canVote: boolean;
}) {
  return (
    <GradeVotes
      proposedGrade={proposedGrade}
      distribution={distribution}
      myVote={myVote}
      onVote={canVote ? (grade) => castGradeVote(climbId, grade) : undefined}
    />
  );
}
