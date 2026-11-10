"use server";

import { flagAreaSensitive } from "../../lib/location";
import { createClient } from "../../lib/supabase/server";
import { enqueueQc } from "../../lib/upload/pipeline";
import {
  createScanForUpload,
  loadOwnUploadedScan,
  verifyUploadComplete,
  type CreateScanInput,
} from "../../lib/upload/scans";

const SIGNED_OUT = {
  ok: false as const,
  error: "Your session expired. Sign in again.",
};

// The user always comes from the session cookie, never from the arguments.
async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

export async function createScan(input: CreateScanInput) {
  const { supabase, user } = await session();
  if (!user) return SIGNED_OUT;
  return createScanForUpload(
    supabase,
    user.id,
    {
      fileName: String(input.fileName),
      fileSize: Number(input.fileSize),
      areaId: input.areaId ? String(input.areaId) : null,
      climbId: input.climbId ? String(input.climbId) : null,
      sensitive: input.sensitive === true,
    },
    { flagArea: (flag) => flagAreaSensitive(flag) },
  );
}

/** Whether a stored resumable upload may continue into this scan. */
export async function canResumeScan(scanId: string) {
  const { supabase, user } = await session();
  if (!user) return SIGNED_OUT;
  return loadOwnUploadedScan(supabase, user.id, String(scanId));
}

export async function notifyUploadComplete(scanId: string) {
  const { supabase, user } = await session();
  if (!user) return SIGNED_OUT;
  return verifyUploadComplete(supabase, user.id, String(scanId), {
    enqueue: enqueueQc,
  });
}
