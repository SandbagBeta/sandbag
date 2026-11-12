import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "../upload/keys";
import type { LifecycleStatus, Review } from "../types";
import { canRetry, latestFeedback } from "./format";

/**
 * Retry = a NEW scan linked to the one it replaces (#17). `scans.retry_of` is
 * not in `authenticated`'s column grants, so the insert uses the service role;
 * ownership is therefore checked here, through the caller's RLS-bound client.
 * No `status` is written: the row is born `uploaded` and only the lifecycle
 * module moves it on.
 */
export type RetryResult =
  { ok: true; scanId: string } | { ok: false; error: string };

interface OwnScan {
  id: string;
  uploader_id: string | null;
  status: LifecycleStatus;
  openbeta_area_id: string | null;
  openbeta_climb_id: string | null;
}

export async function createRetryScan(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  scanId: string,
): Promise<RetryResult> {
  if (!isUuid(scanId)) return { ok: false, error: "Unknown scan." };
  const { data, error } = await userClient
    .from("scans")
    .select("id, uploader_id, status, openbeta_area_id, openbeta_climb_id")
    .eq("id", scanId)
    .maybeSingle();
  const scan = data as OwnScan | null;
  if (error)
    return { ok: false, error: "We couldn't load the scan. Try again." };
  if (!scan || scan.uploader_id !== userId)
    return { ok: false, error: "Unknown scan." };

  const { data: reviews } = await userClient
    .from("reviews")
    .select("verdict, created_at")
    .eq("subject_type", "scan")
    .eq("subject_id", scanId);
  if (!canRetry(scan.status, latestFeedback((reviews ?? []) as Review[]))) {
    return { ok: false, error: "This scan can't be retried." };
  }

  // One retry at a time: reuse an unfinished one instead of piling up scans.
  const { data: existing } = await userClient
    .from("scans")
    .select("id, status")
    .eq("retry_of", scanId)
    .eq("uploader_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const prior = (existing as { id: string; status: string }[] | null)?.[0];
  if (prior) {
    return prior.status === "uploaded"
      ? { ok: true, scanId: prior.id }
      : { ok: false, error: "This scan already has a retry." };
  }

  const { data: created, error: insertError } = await serviceClient
    .from("scans")
    .insert({
      uploader_id: userId,
      retry_of: scanId,
      openbeta_area_id: scan.openbeta_area_id,
      openbeta_climb_id: scan.openbeta_climb_id,
    })
    .select("id")
    .single();
  if (insertError || !created)
    return { ok: false, error: "We couldn't start the retry. Try again." };
  return { ok: true, scanId: (created as { id: string }).id };
}
