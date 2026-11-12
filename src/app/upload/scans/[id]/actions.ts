"use server";

import { redirect } from "next/navigation";
import { createRetryScan } from "@/lib/scan-report/retry";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/** Form action: the user comes from the session cookie, never the form. */
export async function retryScan(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your session expired. Sign in again." };
  const result = await createRetryScan(
    supabase,
    createServiceClient(),
    data.user.id,
    String(formData.get("scanId") ?? ""),
  );
  if (!result.ok) return { error: result.error };
  redirect(`/upload?retry=${result.scanId}`);
}
