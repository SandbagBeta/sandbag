import type { SupabaseClient } from "@supabase/supabase-js";
import type { LifecycleStatus, Scan } from "../types";
import {
  InvalidPatchError,
  LifecycleDbError,
  MissingMeshError,
  TransitionConflictError,
} from "./errors";
import { casStatus } from "./internal";
import { assertQcReport, InvalidQcReportError, qcPassed } from "./qc-report";
import { assertTransition, type LifecycleKind } from "./transitions";

export {
  InvalidPatchError,
  LifecycleDbError,
  MissingMeshError,
  TransitionConflictError,
} from "./errors";
export { TABLE } from "./internal";

/**
 * SERVER ONLY. Applies a status transition with the service-role client, as
 * compare-and-set. Only src/lib/lifecycle/ may write `status` on scans or
 * climbs (enforced by status-guard.test.ts; the column grant in the RLS
 * migration is the DB-level backstop).
 */

/**
 * QC result columns a scan transition may write in the same statement as its
 * status (owner decision on #16), so a scan is never pending_review without
 * its results. Climbs take no patch.
 */
export const SCAN_PATCH_KEYS = [
  "raw_path",
  "glb_path",
  "content_hash",
  "tri_count",
  "texture_res",
  "qc_report",
] as const;

export type ScanPatchKey = (typeof SCAN_PATCH_KEYS)[number];
export type ScanQcPatch = Partial<Pick<Scan, ScanPatchKey>>;

export function assertPublishable(scan: {
  id: string;
  glb_path: string | null;
  content_hash: string | null;
}): void {
  if (!scan.glb_path || !scan.content_hash) throw new MissingMeshError(scan.id);
}

interface TransitionBase {
  id: string;
  from: LifecycleStatus;
  to: LifecycleStatus;
}

export type TransitionRequest =
  | (TransitionBase & { kind: "scan"; patch?: ScanQcPatch })
  | (TransitionBase & { kind: "climb"; patch?: never });

const HASH = /^[0-9a-f]{64}$/;

const isCount = (v: unknown, min: number) =>
  v === null || (Number.isInteger(v) && (v as number) >= min);

/**
 * Validates a patch at runtime (types alone don't stop `as any` or JSON
 * input). Mirrors the scans column checks in schema v1. Returns a copy.
 */
export function assertScanPatch(
  kind: LifecycleKind,
  patch: unknown,
): ScanQcPatch {
  if (patch === undefined) return {};
  if (kind !== "scan") {
    throw new InvalidPatchError(
      `A ${kind} transition takes no patch; only scans carry QC results.`,
    );
  }
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new InvalidPatchError("Patch must be a plain object.");
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(SCAN_PATCH_KEYS as readonly string[]).includes(key)) {
      throw new InvalidPatchError(
        `Patch key "${key}" is not allowed. Allowed: ${SCAN_PATCH_KEYS.join(", ")}.`,
      );
    }
    const k = key as ScanPatchKey;
    const ok =
      k === "raw_path" || k === "glb_path"
        ? value === null || (typeof value === "string" && value !== "")
        : k === "content_hash"
          ? value === null || (typeof value === "string" && HASH.test(value))
          : k === "tri_count"
            ? isCount(value, 0)
            : k === "texture_res"
              ? isCount(value, 1)
              : value === null || validReport(value);
    if (!ok)
      throw new InvalidPatchError(`Patch value for "${key}" is invalid.`);
    out[key] = value;
  }
  return out as ScanQcPatch;
}

function validReport(value: unknown): true {
  try {
    assertQcReport(value);
    return true;
  } catch (err) {
    if (err instanceof InvalidQcReportError) {
      throw new InvalidPatchError(err.message);
    }
    throw err;
  }
}

/**
 * `update <table> set status = to [, ...patch] where id = ? and status = from`,
 * as ONE statement, so the patch lands only if the status change does.
 * Throws InvalidTransitionError or InvalidPatchError (before any DB call),
 * MissingMeshError, TransitionConflictError (zero rows matched; nothing
 * written) or LifecycleDbError.
 *
 * The published → rejected takedown edge is not available here; use takeDown.
 */
export async function applyTransition(
  db: SupabaseClient,
  req: TransitionRequest,
): Promise<void> {
  const { kind, id, from, to } = req;
  assertTransition(kind, from, to);
  const patch = assertScanPatch(kind, req.patch);

  if (
    patch.qc_report &&
    to === "pending_review" &&
    !qcPassed(patch.qc_report)
  ) {
    throw new InvalidPatchError(
      `Scan ${id}: the qc_report has failing error checks, so it must go to failed_qc, not pending_review.`,
    );
  }

  if (kind === "scan" && to === "published") {
    // Patch values count; read the row only for what the patch doesn't set.
    let mesh = {
      id,
      glb_path: patch.glb_path,
      content_hash: patch.content_hash,
    };
    if (mesh.glb_path === undefined || mesh.content_hash === undefined) {
      const { data, error } = await db
        .from("scans")
        .select("id, glb_path, content_hash")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new LifecycleDbError(`reading scan ${id}`, error);
      if (!data) throw new TransitionConflictError(kind, id, from);
      mesh = { ...data, ...stripUndefined(mesh) };
    }
    assertPublishable({
      id,
      glb_path: mesh.glb_path ?? null,
      content_hash: mesh.content_hash ?? null,
    });
  }

  await casStatus(db, kind, id, from, to, patch);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
