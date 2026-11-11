"use server";

import { revalidatePath } from "next/cache";
import { isScanId } from "@/lib/boulder/load";
import { saveVote } from "@/lib/grades/votes";
import { createClient } from "@/lib/supabase/server";

/** Records (or changes) the signed-in user's vote. Throws so the panel rolls back. */
export async function castGradeVote(
  climbId: string,
  grade: string,
): Promise<void> {
  if (!isScanId(climbId)) throw new Error("Unknown climb.");
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Sign in to vote.");
  await saveVote(supabase, climbId, data.user.id, grade);
  revalidatePath(`/climb/${climbId}`);
}
