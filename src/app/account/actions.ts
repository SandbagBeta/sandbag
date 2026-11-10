"use server";

import { revalidatePath } from "next/cache";
import { changeHandle } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

export type HandleFormState = { ok: boolean; message: string } | null;

export async function updateHandle(
  _prev: HandleFormState,
  formData: FormData,
): Promise<HandleFormState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user)
    return { ok: false, message: "Your session expired. Sign in again." };

  const result = await changeHandle(
    supabase,
    data.user.id,
    formData.get("handle"),
  );
  if (!result.ok) return { ok: false, message: result.error };
  revalidatePath("/account");
  return { ok: true, message: result.message };
}
