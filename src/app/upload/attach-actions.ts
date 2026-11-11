"use server";

import { createClient } from "../../lib/supabase/server";
import { listAttachClimbs, searchAttachAreas } from "../../lib/upload/attach";

// Signed-in users only: these spend the shared OpenBeta throttle.
async function signedIn() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user !== null;
}
const SIGNED_OUT = {
  ok: false as const,
  error: "Your session expired. Sign in again.",
};

export async function searchAreasAction(query: string) {
  if (!(await signedIn())) return SIGNED_OUT;
  return searchAttachAreas(String(query));
}

export async function listClimbsAction(areaId: string) {
  if (!(await signedIn())) return SIGNED_OUT;
  return listAttachClimbs(String(areaId));
}
