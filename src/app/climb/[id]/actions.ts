"use server";

import { revalidatePath } from "next/cache";
import {
  logFailure,
  newReference,
  reportPathFor,
} from "@/lib/annotations/failureLog";
import { isScanId } from "@/lib/boulder/load";
import { saveVote, VoteError } from "@/lib/grades/votes";
import { voteFailureHelp, type VoteOutcome } from "@/lib/grades/voteFailure";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const fail = (help: ReturnType<typeof voteFailureHelp>): VoteOutcome => ({
  ok: false,
  help,
});

/**
 * Records (or changes) the signed-in user's vote. Returns the outcome instead
 * of throwing: production Next.js hides thrown messages from the browser, so
 * the panel could not tell "sign in" from "our bug". A failure on our side is
 * logged privately with a reference (`failure_logs`, stage `database`).
 */
export async function castGradeVote(
  climbId: string,
  grade: string,
): Promise<VoteOutcome> {
  if (!isScanId(climbId)) return fail(voteFailureHelp("unknown_climb"));
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return fail(voteFailureHelp("signed_out"));
  try {
    await saveVote(supabase, climbId, data.user.id, grade);
  } catch (e) {
    const code = e instanceof VoteError ? e.code : "error";
    if (code !== "error") return fail(voteFailureHelp(code));
    const reference = newReference();
    let logged = false;
    try {
      logged = await logFailure(createServiceClient(), {
        reference,
        stage: "database",
        code: "vote_failed",
        userId: data.user.id,
        detail: e instanceof Error ? e.message : undefined,
      });
    } catch {
      /* no service client: the user still gets the explanation */
    }
    return fail(
      voteFailureHelp(
        "error",
        logged
          ? { reference, reportPath: reportPathFor(reference) }
          : undefined,
      ),
    );
  }
  revalidatePath(`/climb/${climbId}`);
  return { ok: true };
}
