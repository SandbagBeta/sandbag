import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isUuid,
  parseRawObjectKey,
  rawFolder,
  rawObjectKey,
  UPLOADS_BUCKET,
} from "./keys";
import { checkUploadFile, MAX_UPLOAD_BYTES } from "./validate";

/**
 * Server logic for the upload flow (#15). Every function takes the caller's
 * session client, so RLS decides what they may touch; the service role is
 * never used here. Status is never written: scans are born `uploaded` and
 * only the lifecycle module moves them on.
 */

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface CreateScanInput {
  fileName: string;
  fileSize: number;
  areaId?: string | null;
  climbId?: string | null;
  sensitive?: boolean;
}

export interface FlagArea {
  (input: {
    areaId: string;
    profileId: string;
    reason: string;
  }): Promise<unknown>;
}

export const SENSITIVE_REASON =
  "Contributor marked the area sensitive or closed at upload (#15).";

function optionalUuid(
  raw: string | null | undefined,
  label: string,
): Result<{ value: string | null }> {
  const v = raw?.trim() ?? "";
  if (!v) return { ok: true, value: null };
  if (!isUuid(v))
    return { ok: false, error: `${label} must be a UUID like 0f8c…-…-…` };
  return { ok: true, value: v.toLowerCase() };
}

export async function createScanForUpload(
  client: SupabaseClient,
  userId: string,
  input: CreateScanInput,
  deps: { flagArea: FlagArea },
): Promise<
  Result<{ scanId: string; objectName: string; contentType: string }>
> {
  const file = checkUploadFile({ name: input.fileName, size: input.fileSize });
  if (!file.ok) return file;
  const area = optionalUuid(input.areaId, "OpenBeta area id");
  if (!area.ok) return area;
  const climb = optionalUuid(input.climbId, "OpenBeta climb id");
  if (!climb.ok) return climb;

  if (input.sensitive) {
    if (!area.value) {
      return {
        ok: false,
        error: "Add the OpenBeta area id so we know which area to hide.",
      };
    }
    // Before the scan exists: if the flag can't land, nothing is uploaded.
    // The profile id is the session user, never a form field.
    try {
      await deps.flagArea({
        areaId: area.value,
        profileId: userId,
        reason: SENSITIVE_REASON,
      });
    } catch {
      return {
        ok: false,
        error:
          "We couldn't record that the area is sensitive, so nothing was uploaded. Try again.",
      };
    }
  }

  // Only the columns `authenticated` may insert (#3): status defaults to
  // `uploaded`; raw_path/glb_path/content_hash are left to the pipeline.
  const { data, error } = await client
    .from("scans")
    .insert({
      uploader_id: userId,
      openbeta_area_id: area.value,
      openbeta_climb_id: climb.value,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23503") {
      return {
        ok: false,
        error:
          "SandBag doesn't know that OpenBeta area or climb yet. Leave it blank for now and attach it later.",
      };
    }
    return { ok: false, error: "We couldn't create the scan. Try again." };
  }
  const scanId = (data as { id: string }).id;
  return {
    ok: true,
    scanId,
    objectName: rawObjectKey(userId, scanId, file.kind),
    contentType: file.contentType,
  };
}

/** The caller's own scan, still `uploaded`; otherwise an error. */
export async function loadOwnUploadedScan(
  client: SupabaseClient,
  userId: string,
  scanId: string,
): Promise<Result<object>> {
  if (!isUuid(scanId)) return { ok: false, error: "Unknown scan." };
  const { data, error } = await client
    .from("scans")
    .select("id, uploader_id, status")
    .eq("id", scanId)
    .maybeSingle();
  if (error)
    return { ok: false, error: "We couldn't check the scan. Try again." };
  // RLS hides other people's unpublished scans; check anyway.
  const scan = data as { uploader_id: string | null; status: string } | null;
  if (!scan || scan.uploader_id !== userId)
    return { ok: false, error: "Unknown scan." };
  if (scan.status !== "uploaded") {
    return { ok: false, error: "This scan is already past the upload step." };
  }
  return { ok: true };
}

export interface QcJob {
  scanId: string;
  /** Object name in the `uploads` bucket. */
  rawPath: string;
}

/**
 * Upload-complete hook: confirm the raw file exists under the caller's
 * `uploaded` scan, then hand it to the QC pipeline. Changes no status.
 */
export async function verifyUploadComplete(
  client: SupabaseClient,
  userId: string,
  scanId: string,
  deps: { enqueue: (job: QcJob) => Promise<void> },
): Promise<Result<object>> {
  const scan = await loadOwnUploadedScan(client, userId, scanId);
  if (!scan.ok) return scan;

  const folder = rawFolder(userId, scanId);
  const { data, error } = await client.storage
    .from(UPLOADS_BUCKET)
    .list(folder);
  if (error)
    return { ok: false, error: "We couldn't check the upload. Try again." };
  const files = (data ?? []).filter((f) =>
    parseRawObjectKey(`${folder}/${f.name}`),
  );
  const [raw] = files;
  if (!raw || files.length !== 1)
    return { ok: false, error: "The upload hasn't finished yet." };
  const size = Number((raw.metadata as { size?: number } | null)?.size ?? 0);
  if (size > MAX_UPLOAD_BYTES)
    return { ok: false, error: "That file is over 200 MB." };

  await deps.enqueue({ scanId, rawPath: `${folder}/${raw.name}` });
  return { ok: true };
}
