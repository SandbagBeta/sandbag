"use server";

import { revalidatePath } from "next/cache";
import { submitReview } from "@/lib/lifecycle";
import { decideReview, type DecideResult } from "@/lib/review/decide";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type ReviewFormState = DecideResult | null;

/**
 * Identity and trust level come from the session and the profiles table,
 * never from the form. The status flip goes through lifecycle `submitReview`.
 */
export async function submitReviewAction(
  _prev: ReviewFormState,
  formData: FormData,
): Promise<ReviewFormState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return { ok: false, error: "Your session expired. Sign in again." };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("trust_level")
    .eq("id", data.user.id)
    .maybeSingle();

  const result = await decideReview(
    {
      reviewerId: data.user.id,
      trustLevel: profile?.trust_level ?? null,
      submit: (input) => submitReview(createServiceClient(), input),
    },
    {
      subjectType: formData.get("subjectType") === "climb" ? "climb" : "scan",
      subjectId: String(formData.get("subjectId") ?? ""),
      verdict: formData.get("verdict"),
      reason: formData.get("reason"),
      checked: formData.getAll("checked").map(String),
    },
  );
  if (result.ok) revalidatePath("/review", "layout");
  return result;
}
