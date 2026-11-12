import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "./keys";

/**
 * The private "can't find it" note (#28, table scan_attach_notes). Free text
 * can carry coordinates or directions to a secret spot (PRD §2), so it is
 * written and read only with the caller's session client (RLS: uploader and
 * reviewers), and callers must never render it on a public page.
 */

export const MAX_NOTE_LENGTH = 500;
// Mirrors the table's backstop check: two decimals in a row look like lat/lng.
const COORD_PAIR = /-?\d{1,3}\.\d{3,}\s*[,;/ ]\s*-?\d{1,3}\.\d{3,}/;

export type NoteResult = { ok: true } | { ok: false; error: string };

/** Trimmed note, or an error message. Empty input is not an error: it means "no note". */
export function checkAttachNote(
  raw: unknown,
): { ok: true; note: string | null } | { ok: false; error: string } {
  const note = typeof raw === "string" ? raw.trim() : "";
  if (!note) return { ok: true, note: null };
  if (note.length > MAX_NOTE_LENGTH)
    return {
      ok: false,
      error: `Keep the note under ${MAX_NOTE_LENGTH} characters.`,
    };
  if (COORD_PAIR.test(note))
    return {
      ok: false,
      error:
        "Please don't put coordinates in the note. Describe the boulder in words; a reviewer will match it.",
    };
  return { ok: true, note };
}

export async function saveAttachNote(
  client: SupabaseClient,
  scanId: string,
  raw: unknown,
): Promise<NoteResult> {
  if (!isUuid(scanId)) return { ok: false, error: "Scan not found." };
  const checked = checkAttachNote(raw);
  if (!checked.ok) return checked;
  if (checked.note === null) return { ok: true };
  const { error } = await client
    .from("scan_attach_notes")
    .upsert({ scan_id: scanId, note: checked.note }, { onConflict: "scan_id" });
  return error
    ? { ok: false, error: "Couldn't save the note. Try again." }
    : { ok: true };
}

/** RLS returns the row only to the uploader or a reviewer; otherwise null. */
export async function loadAttachNote(
  client: SupabaseClient,
  scanId: string,
): Promise<string | null> {
  if (!isUuid(scanId)) return null;
  const { data } = await client
    .from("scan_attach_notes")
    .select("note")
    .eq("scan_id", scanId)
    .maybeSingle();
  return (data as { note: string } | null)?.note ?? null;
}
