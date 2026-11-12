import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildHelp,
  isUserFixable,
  type FailureHelp,
  type FailureStage,
  type RawFailure,
} from "./failureHelp";
import {
  logFailure,
  newReference,
  reportPathFor,
  type FailureLogEntry,
} from "./failureLog";
import { loadCanonicalSurface } from "./loadSurface";
import type { SaveClimbInput } from "./saveInput";
import {
  validateClimbAnnotations,
  type AnnotationIssue,
  type MeshSurface,
} from "./validate";

/**
 * SERVER ONLY. Validates a climb submission against the scan's canonical mesh,
 * then writes it through the service-role RPCs from migration
 * `20261112000500_annotation_rpcs.sql` (issue #22). The caller has already
 * authenticated the user: `userId` must come from the session, never the body.
 *
 * Every failure carries `help` (product decision, 2026-11-12): which stage
 * failed, what happened, what the user can do and the next steps. A failure
 * the user can fix is only explained. One they can't is logged to the private
 * `failure_logs` table, and `help` then carries a `reference` and a
 * `reportPath` link. Provider and database messages are never returned.
 */

interface FailureBase {
  ok: false;
  /** Same as `help.whatHappened`, kept for callers that only show a line. */
  message: string;
  help: FailureHelp;
}

export type SaveFailure =
  /** The payload or the annotations are wrong; `issues` say what to fix. */
  | (FailureBase & { code: "validation"; issues: AnnotationIssue[] })
  | (FailureBase & {
      code: "not_found" | "forbidden" | "stale" | "mesh_unavailable" | "error";
    });

export type SaveResult = { ok: true; climbId: string } | SaveFailure;

interface ScanRow {
  id: string;
  status: string;
  content_hash: string | null;
  glb_path: string | null;
}
interface ClimbRow {
  id: string;
  scan_id: string;
  name: string;
  created_by: string | null;
  status: string;
}

export interface SaveDeps {
  loadScan(id: string): Promise<ScanRow | null>;
  /** Every climb on the scan, any status. */
  listClimbs(scanId: string): Promise<{ id: string; name: string }[]>;
  loadClimb(id: string): Promise<ClimbRow | null>;
  loadSurface(ref: {
    content_hash: string;
    glb_path: string;
  }): Promise<MeshSurface>;
  rpc(
    fn: "create_climb_annotations" | "replace_climb_annotations",
    args: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
  /** Writes a row to the private failure log. Never throws; false if it failed. */
  logFailure(entry: FailureLogEntry): Promise<boolean>;
}

export function supabaseSaveDeps(db: SupabaseClient): SaveDeps {
  return {
    async loadScan(id) {
      const { data, error } = await db
        .from("scans")
        .select("id, status, content_hash, glb_path")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`loading scan: ${error.message}`);
      return (data as ScanRow | null) ?? null;
    },
    async listClimbs(scanId) {
      const { data, error } = await db
        .from("climbs")
        .select("id, name")
        .eq("scan_id", scanId);
      if (error) throw new Error(`listing climbs: ${error.message}`);
      return (data as { id: string; name: string }[] | null) ?? [];
    },
    async loadClimb(id) {
      const { data, error } = await db
        .from("climbs")
        .select("id, scan_id, name, created_by, status")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`loading climb: ${error.message}`);
      return (data as ClimbRow | null) ?? null;
    },
    loadSurface: (ref) => loadCanonicalSurface(db, ref),
    rpc: async (fn, args) => {
      const { data, error } = await db.rpc(fn, args);
      return { data, error };
    },
    logFailure: (entry) => logFailure(db, entry),
  };
}

/** A failure at a known stage, thrown out of a guarded step. */
class StageError extends Error {
  constructor(
    readonly stage: FailureStage,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

/** Runs a step, labelling anything it throws with the stage it belongs to. */
async function at<T>(stage: FailureStage, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    throw new StageError(stage, err);
  }
}

const raw = (
  code: RawFailure["code"],
  stage: FailureStage,
  message: string,
  detail?: string,
): RawFailure => ({ code, stage, message, ...(detail ? { detail } : {}) });

/** Maps a database function error to a failure. The message is never shown. */
export function mapRpcError(error: {
  code?: string;
  message: string;
}): RawFailure {
  const detail = `${error.code ?? "?"}: ${error.message}`;
  if (error.code === "23505") {
    return {
      code: "validation",
      stage: "validation",
      message: "A climb with that name already exists on this scan.",
      issues: [
        {
          code: "name_duplicate",
          message: "A climb with that name already exists on this scan.",
          field: "name",
        },
      ],
    };
  }
  if (error.code === "42501")
    return raw("forbidden", "access", "You can't edit this climb.", detail);
  if (error.code === "23514") {
    if (/hash_mismatch|scan_not_published/.test(error.message))
      return raw("stale", "scan", "The scan's mesh changed.", detail);
    if (/not_pending/.test(error.message))
      return raw(
        "forbidden",
        "access",
        "Only climbs waiting for review can be edited.",
        detail,
      );
    // too_few_holds, start_holds_count, foot_in_sequence, duplicate_path_kind:
    // the validator catches these first; reaching here means the two drifted.
    return raw("error", "database", "The annotations were rejected.", detail);
  }
  return raw("error", "database", "Saving failed.", detail);
}

interface SaveContext {
  userId: string;
  scanId: string | null;
  climbId: string | null;
  context: Record<string, number | string | boolean>;
}

/**
 * Turns a raw failure into what the caller returns. A failure the user can't
 * fix is logged first, and the reference is shown only if the log write worked
 * (a reference nobody can look up would send the user nowhere).
 */
async function finalize(
  deps: Pick<SaveDeps, "logFailure">,
  ctx: SaveContext,
  failure: RawFailure,
): Promise<SaveFailure> {
  let ref: { reference: string; reportPath: string } | undefined;
  if (!isUserFixable(failure)) {
    const reference = newReference();
    const logged = await deps.logFailure({
      reference,
      stage: failure.stage,
      code: failure.code,
      userId: ctx.userId,
      scanId: ctx.scanId,
      climbId: ctx.climbId,
      detail: failure.detail ?? failure.message,
      context: ctx.context,
    });
    if (logged) ref = { reference, reportPath: reportPathFor(reference) };
  }
  const help = buildHelp(failure, ref);
  const base = { ok: false as const, message: help.whatHappened, help };
  return failure.code === "validation"
    ? { ...base, code: "validation", issues: failure.issues ?? [] }
    : { ...base, code: failure.code };
}

/**
 * The payload couldn't be read. Field problems (a name that is too long) are
 * the user's to fix; anything else is the app's fault and is logged.
 */
export function rejectPayload(
  deps: Pick<SaveDeps, "logFailure">,
  userId: string,
  issues: AnnotationIssue[],
): Promise<SaveFailure> {
  return finalize(
    deps,
    { userId, scanId: null, climbId: null, context: { mode: "payload" } },
    {
      code: "validation",
      stage: "payload",
      message: issues.map((i) => i.message).join(" "),
      issues,
      detail: issues
        .map((i) => `${i.code}${i.field ? `:${i.field}` : ""}`)
        .join(","),
    },
  );
}

type Outcome = { ok: true; climbId: string } | RawFailure;

async function attempt(
  deps: SaveDeps,
  userId: string,
  input: SaveClimbInput,
): Promise<Outcome> {
  const scan = await at("database", () => deps.loadScan(input.scanId));
  if (
    !scan ||
    scan.status !== "published" ||
    !scan.content_hash ||
    !scan.glb_path
  ) {
    return raw("not_found", "scan", "That scan isn't available.");
  }
  if (scan.content_hash !== input.scanContentHash) {
    return raw("stale", "scan", "The scan's mesh changed.");
  }

  let name = input.name;
  let climb: ClimbRow | null = null;
  if (input.climbId) {
    const climbId = input.climbId;
    climb = await at("database", () => deps.loadClimb(climbId));
    if (!climb || climb.scan_id !== scan.id)
      return raw("not_found", "scan", "That climb isn't available.");
    if (climb.created_by !== userId)
      return raw("forbidden", "access", "You can't edit this climb.");
    if (climb.status !== "pending_review")
      return raw(
        "forbidden",
        "access",
        "Only climbs waiting for review can be edited.",
      );
    name = climb.name; // replace keeps the name; the validator needs a valid one
  }

  let mesh: MeshSurface;
  try {
    mesh = await deps.loadSurface({
      content_hash: scan.content_hash,
      glb_path: scan.glb_path,
    });
  } catch (err) {
    return raw(
      "mesh_unavailable",
      "mesh",
      "The scan's mesh couldn't be loaded.",
      err instanceof Error ? err.message : String(err),
    );
  }

  const scanId = scan.id;
  const own = climb?.id;
  const others = (await at("database", () => deps.listClimbs(scanId))).filter(
    (c) => c.id !== own,
  );
  const issues = validateClimbAnnotations(
    {
      name,
      holds: input.holds.map((h) => ({
        id: h.id,
        scan_content_hash: input.scanContentHash,
        position: h.position,
        face_index: h.face_index,
        type: h.type,
        seq_order: h.seq_order,
      })),
    },
    {
      scanContentHash: scan.content_hash,
      mesh,
      existingNames: others.map((c) => c.name),
    },
  );
  if (issues.length) {
    return {
      code: "validation",
      stage: "validation",
      message: issues.map((i) => i.message).join(" "),
      issues,
    };
  }

  const holds = input.holds.map((h) => ({
    position: h.position,
    normal: h.normal,
    face_index: h.face_index,
    type: h.type,
    seq_order: h.seq_order,
  }));
  const paths = input.paths.map((p) => ({ kind: p.kind, points: p.points }));

  if (climb) {
    const { error } = await at("database", () =>
      deps.rpc("replace_climb_annotations", {
        p_user_id: userId,
        p_climb_id: climb.id,
        p_scan_content_hash: input.scanContentHash,
        p_holds: holds,
        p_paths: paths,
      }),
    );
    return error ? mapRpcError(error) : { ok: true, climbId: climb.id };
  }
  const { data, error } = await at("database", () =>
    deps.rpc("create_climb_annotations", {
      p_user_id: userId,
      p_scan_id: scan.id,
      p_scan_content_hash: input.scanContentHash,
      p_name: input.name,
      p_description: input.description,
      p_proposed_grade: input.proposedGrade,
      p_fa_info: input.faInfo,
      p_holds: holds,
      p_paths: paths,
    }),
  );
  if (error) return mapRpcError(error);
  if (typeof data !== "string")
    return raw("error", "database", "Saving failed.", "no climb id returned");
  return { ok: true, climbId: data };
}

export async function saveClimbAnnotations(
  deps: SaveDeps,
  userId: string,
  input: SaveClimbInput,
): Promise<SaveResult> {
  const feet = input.holds.filter((h) => h.type === "foot").length;
  const ctx: SaveContext = {
    userId,
    scanId: input.scanId,
    climbId: input.climbId,
    context: {
      mode: input.climbId ? "replace" : "create",
      holds: input.holds.length - feet,
      feet,
      paths: input.paths.length,
    },
  };
  let outcome: Outcome;
  try {
    outcome = await attempt(deps, userId, input);
  } catch (err) {
    // A guarded step threw (database lookup or write), or something else did.
    outcome = raw(
      "error",
      err instanceof StageError ? err.stage : "unknown",
      "Saving failed.",
      err instanceof Error ? err.message : String(err),
    );
  }
  if ("ok" in outcome) return outcome;
  return finalize(deps, ctx, outcome);
}
