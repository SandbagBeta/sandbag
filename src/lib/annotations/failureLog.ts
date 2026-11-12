import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FailureStage } from "./failureHelp";

/**
 * SERVER ONLY. The private failure log (migration
 * `20261113000100_failure_logs.sql`). Failures the user can't fix are recorded
 * here under a short reference, and the user is given that reference and a
 * link to report it. The log never receives file contents, names, hold
 * positions or coordinates: only the stage, a code, ids, a sanitized provider
 * message and a few counts.
 */

// Crockford base32 (no I, L, O, U): easy to read out loud. 256 is a multiple
// of 32, so taking a random byte modulo 32 is unbiased.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newReference(bytes: Uint8Array = randomBytes(8)): string {
  return "SB-" + Array.from(bytes, (b) => ALPHABET[b % 32]).join("");
}

export const REFERENCE_PATTERN = /^SB-[0-9A-HJKMNP-TV-Z]{8}$/;

/** Where the user reports a logged failure (the page is a frontend job). */
export const reportPathFor = (reference: string) =>
  `/report-problem?ref=${encodeURIComponent(reference)}`;

/**
 * Provider and exception text can name buckets, paths or, in theory, a value
 * the user sent. Keep it short, one line, free of control characters, and with
 * anything that looks like a pair of decimal coordinates removed.
 */
export function cleanDetail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/-?\d{1,3}\.\d{3,}\s*[,;/ ]\s*-?\d{1,3}\.\d{3,}/g, "[removed]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return cleaned || null;
}

export interface FailureLogEntry {
  reference: string;
  stage: FailureStage;
  code: string;
  userId: string | null;
  scanId?: string | null;
  climbId?: string | null;
  detail?: unknown;
  /** Counts only, e.g. { holds: 12, feet: 3, paths: 1, mode: "create" }. */
  context?: Record<string, number | string | boolean>;
}

/** Writes one row. Never throws: a log problem must not hide the real error. */
export async function logFailure(
  db: SupabaseClient,
  entry: FailureLogEntry,
): Promise<boolean> {
  try {
    const { error } = await db.from("failure_logs").insert({
      reference: entry.reference,
      stage: entry.stage,
      code: entry.code.slice(0, 40),
      user_id: entry.userId,
      scan_id: entry.scanId ?? null,
      climb_id: entry.climbId ?? null,
      detail: cleanDetail(entry.detail),
      context: entry.context ?? {},
    });
    if (error) {
      console.error(`failure log write failed for ${entry.reference}`);
      return false;
    }
    return true;
  } catch {
    console.error(`failure log write failed for ${entry.reference}`);
    return false;
  }
}

export type ReportResult =
  | { ok: true }
  | {
      ok: false;
      code: "invalid_note" | "not_found" | "error";
      message: string;
    };

/**
 * The user adds a note to a failure they hit. `userId` must come from the
 * session. Only the user the failure happened to can report it.
 */
export async function reportFailure(
  db: SupabaseClient,
  userId: string,
  reference: string,
  note: string,
): Promise<ReportResult> {
  if (!REFERENCE_PATTERN.test(reference)) {
    return {
      ok: false,
      code: "not_found",
      message: "That reference isn't valid. Check it and try again.",
    };
  }
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (trimmed.length === 0 || trimmed.length > 1000) {
    return {
      ok: false,
      code: "invalid_note",
      message:
        "Write a short note (up to 1000 characters) about what happened.",
    };
  }
  const { data, error } = await db.rpc("report_failure", {
    p_reference: reference,
    p_user_id: userId,
    p_note: trimmed,
  });
  if (error) {
    return {
      ok: false,
      code: "error",
      message: "Your report couldn't be sent. Try again in a moment.",
    };
  }
  return data === true
    ? { ok: true }
    : {
        ok: false,
        code: "not_found",
        message:
          "We couldn't find that failure on your account. Check the reference and try again.",
      };
}
