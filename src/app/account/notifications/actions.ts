"use server";

import { revalidatePath } from "next/cache";
import { markAllRead } from "@/lib/review/notifications";
import { createClient } from "@/lib/supabase/server";

export async function markAllReadAction(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  await markAllRead(supabase);
  revalidatePath("/account", "layout");
}
