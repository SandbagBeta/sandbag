"use server";

import { revalidatePath } from "next/cache";
import { setScanScale, submitReview } from "@/lib/lifecycle";
import {
  logFailure,
  newReference,
  reportPathFor,
} from "@/lib/annotations/failureLog";
import {
  SCALE_SIGNED_OUT,
  setScaleFor,
  type ScaleFormState,
} from "@/lib/review/scale";
import { redirect } from "next/navigation";
import {
  decideReview,
  reviewRedirect,
  type DecideResult,
} from "@/lib/review/decide";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type ReviewFormState = DecideResult | null;

/**
 * Sets the scan's reviewed scale (#137). Identity and trust come from the
 * session, never the form. The write is lifecycle `setScanScale`; an error on
 * our side is logged privately and the maintainer gets a reference.
 */
export async function setScaleAction(
  _prev: ScaleFormState,
  formData: FormData,
): Promise<ScaleFormState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, help: SCALE_SIGNED_OUT };
  const userId = data.user.id;
  const { data: profile } = await supabase
    .from("profiles")
    .select("trust_level")
    .eq("id", userId)
    .maybeSingle();
  const scanId = String(formData.get("scanId") ?? "");
  const db = createServiceClient();

  const result = await setScaleFor(
    {
      maintainerId: userId,
      trustLevel: profile?.trust_level ?? null,
      set: ({ scanId, factor }) =>
        setScanScale(db, { maintainerId: userId, scanId, factor }),
      logUnexpected: async (err) => {
        const reference = newReference();
        const logged = await logFailure(db, {
          reference,
          stage: "database",
          code: "set_scale_failed",
          userId,
          scanId,
          detail: err instanceof Error ? err.message : undefined,
        });
        return logged
          ? { reference, reportPath: reportPathFor(reference) }
          : null;
      },
    },
    { scanId, factor: formData.get("factor") },
  );
  if (result?.ok) revalidatePath(`/review/${scanId}`);
  return result;
}

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
  if (result.ok) {
    revalidatePath("/review", "layout");
    // Outside any try/catch: redirect() throws by design.
    const to = reviewRedirect(formData.get("verdict"));
    if (to) redirect(to);
  }
  return result;
}
