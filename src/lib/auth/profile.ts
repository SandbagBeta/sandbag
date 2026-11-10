import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Profile } from "../types";
import {
  handleSource,
  normalizeHandle,
  validateHandle,
  withSuffix,
} from "./handle";

/**
 * Profile rows are written with the signed-in user's own client, so the
 * `profiles_insert_self` / `profiles_update_self` RLS policies apply. Never
 * pass a service-role client here.
 */

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
export const MAX_HANDLE_ATTEMPTS = 8;

type PgError = { code?: string; message?: string } | null;

/** 23505 on the primary key means the row already exists (e.g. a racing callback). */
function isPkeyConflict(err: PgError): boolean {
  return (
    err?.code === UNIQUE_VIOLATION && /profiles_pkey/.test(err.message ?? "")
  );
}

export type EnsureProfileResult =
  | { status: "exists" | "created"; handle: Profile["handle"] }
  | { status: "error"; error: string };

async function readHandle(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("handle")
    .eq("id", id)
    .maybeSingle();
  return { handle: (data as Pick<Profile, "handle"> | null)?.handle, error };
}

/**
 * Create the user's profile on first sign-in; no-op if it exists. Tries the
 * normalized provider handle, then `<base>_<4 digits>` on each unique
 * violation. Insert-and-retry (not check-then-insert) so concurrent sign-ups
 * cannot both pass a check and collide.
 */
export async function ensureProfile(
  supabase: SupabaseClient,
  user: Pick<User, "id" | "email" | "user_metadata">,
  { random = Math.random, maxAttempts = MAX_HANDLE_ATTEMPTS } = {},
): Promise<EnsureProfileResult> {
  const existing = await readHandle(supabase, user.id);
  if (existing.error)
    return { status: "error", error: "profile lookup failed" };
  if (existing.handle) return { status: "exists", handle: existing.handle };

  const base = normalizeHandle(handleSource(user));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const handle =
      attempt === 0
        ? base
        : withSuffix(base, 1000 + Math.floor(random() * 9000));
    const { error } = await supabase
      .from("profiles")
      .insert({ id: user.id, handle });
    if (!error) return { status: "created", handle };
    if (isPkeyConflict(error)) {
      const again = await readHandle(supabase, user.id);
      if (again.handle) return { status: "exists", handle: again.handle };
      return { status: "error", error: "profile lookup failed" };
    }
    if (error.code !== UNIQUE_VIOLATION)
      return {
        status: "error",
        error: `profile insert failed (${error.code ?? "unknown"})`,
      };
  }
  return { status: "error", error: "no free handle after retries" };
}

export type ChangeHandleResult =
  { ok: true; handle: string; message: string } | { ok: false; error: string };

/** Update the signed-in user's handle (RLS: own row, `handle` column only). */
export async function changeHandle(
  supabase: SupabaseClient,
  userId: string,
  input: unknown,
): Promise<ChangeHandleResult> {
  const v = validateHandle(input);
  if (!v.ok) return v;
  const { data, error } = await supabase
    .from("profiles")
    .update({ handle: v.handle })
    .eq("id", userId)
    .select("handle");
  if (error?.code === UNIQUE_VIOLATION)
    return { ok: false, error: `"${v.handle}" is taken. Try another handle.` };
  if (error?.code === CHECK_VIOLATION)
    return {
      ok: false,
      error: "Use 3-32 lowercase letters, digits or underscores.",
    };
  if (error)
    return { ok: false, error: "Could not save your handle. Try again." };
  if (!data || data.length === 0)
    return { ok: false, error: "No profile found for your account." };
  return {
    ok: true,
    handle: v.handle,
    message: `Saved. You are now @${v.handle}.`,
  };
}
