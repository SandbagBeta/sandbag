import type { SupabaseClient } from "@supabase/supabase-js";
import type { Review, ReviewVerdict } from "@/lib/types";

/**
 * Contributor-facing verdict notices (issue #19). Reads use the user's own
 * session: `notifications_read_own` limits rows to theirs, and `reviews_read`
 * lets an author see the verdict and reason on their own scan/climb.
 */

export interface NotificationView {
  id: string;
  created_at: string;
  unread: boolean;
  verdict: ReviewVerdict;
  subjectType: Review["subject_type"];
  /** Climb name, or null (scans have no name). */
  subjectName: string | null;
  reason: string | null;
  /** What the contributor can do next, by verdict. */
  message: string;
}

export function verdictMessage(
  verdict: ReviewVerdict,
  subject: "scan" | "climb" | "area",
  name: string | null,
): string {
  const what = name ? `Your climb "${name}"` : `Your ${subject}`;
  switch (verdict) {
    case "approve":
      return `${what} was approved and is now published.`;
    case "request_changes":
      return `${what} needs changes before it can be published.`;
    case "reject":
      return `${what} was rejected.`;
  }
}

type Row = {
  id: string;
  created_at: string;
  read_at: string | null;
  reviews: Pick<
    Review,
    "verdict" | "reason" | "subject_type" | "subject_id"
  > | null;
};

export async function loadNotifications(
  db: SupabaseClient,
  limit = 50,
): Promise<NotificationView[]> {
  const { data, error } = await db
    .from("notifications")
    .select(
      "id, created_at, read_at, reviews(verdict, reason, subject_type, subject_id)",
    )
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Row[]>();
  if (error) throw new Error(`Could not load notifications: ${error.message}`);
  const rows = (data ?? []).filter((r) => r.reviews);

  const climbIds = rows
    .filter((r) => r.reviews?.subject_type === "climb")
    .map((r) => r.reviews!.subject_id);
  const names = new Map<string, string>();
  if (climbIds.length) {
    const { data: climbs } = await db
      .from("climbs")
      .select("id, name")
      .in("id", climbIds);
    for (const c of climbs ?? []) names.set(c.id as string, c.name as string);
  }

  return rows.map((r) => {
    const rv = r.reviews!;
    const name = names.get(rv.subject_id) ?? null;
    return {
      id: r.id,
      created_at: r.created_at,
      unread: r.read_at === null,
      verdict: rv.verdict,
      subjectType: rv.subject_type,
      subjectName: name,
      reason: rv.reason,
      message: verdictMessage(rv.verdict, rv.subject_type, name),
    };
  });
}

export async function countUnread(db: SupabaseClient): Promise<number> {
  const { count } = await db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  return count ?? 0;
}

/** Marks the caller's unread notifications read (RLS limits to their own). */
export async function markAllRead(db: SupabaseClient): Promise<void> {
  const { error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error)
    throw new Error(`Could not mark notifications read: ${error.message}`);
}
