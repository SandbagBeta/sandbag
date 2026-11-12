/**
 * Server-side annotation validity checks (issue #23). Pure: no I/O. The caller
 * loads the scan, the sibling climb names and the mesh for `scan.content_hash`,
 * then calls {@link assertValidClimbAnnotations} before inserting anything.
 * All geometry is mesh-local (see types.ts); nothing here touches geo coords.
 */
import type { HoldType, Vec3 } from "../types";

/** Max distance (m) from a hold to its claimed mesh face. */
export const SURFACE_TOLERANCE_M = 0.05;
export const MIN_START_HOLDS = 1;
export const MAX_START_HOLDS = 2;
export const MIN_TOTAL_HOLDS = 3;

export interface HoldInput {
  id: string;
  scan_content_hash: string;
  position: Vec3;
  face_index: number;
  type: HoldType;
  seq_order?: number | null;
}

export interface ClimbSubmission {
  name: string;
  holds: HoldInput[];
}

/** Indexed triangle mesh of the canonical GLB (flattened xyz positions). */
export interface MeshSurface {
  positions: ArrayLike<number>;
  /** Triangle index buffer; `indices[3i..3i+2]` is face `i`. */
  indices: ArrayLike<number>;
}

export interface ValidationContext {
  /** The scan's current mesh hash; holds must match it. */
  scanContentHash: string | null;
  /** Mesh whose sha256 is `scanContentHash` (caller's responsibility). */
  mesh: MeshSurface;
  /** Names of other climbs on this scan (any status). */
  existingNames: readonly string[];
  tolerance?: number;
}

export type AnnotationIssueCode =
  | "name_empty"
  | "name_duplicate"
  | "start_holds_count"
  | "too_few_holds"
  | "duplicate_hold_id"
  | "hash_mismatch"
  | "face_out_of_range"
  | "off_surface"
  | "bad_sequence"
  /** Malformed payload field (shape, range, non-unit normal). */
  | "bad_payload";

export interface AnnotationIssue {
  code: AnnotationIssueCode;
  message: string;
  holdId?: string;
}

export class AnnotationValidationError extends Error {
  constructor(readonly issues: AnnotationIssue[]) {
    super(
      `Invalid climb annotations: ${issues.map((i) => i.message).join("; ")}`,
    );
    this.name = "AnnotationValidationError";
  }
}

const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

const sub3 = (u: Vec3, v: Vec3): Vec3 => [
  u[0] - v[0],
  u[1] - v[1],
  u[2] - v[2],
];
const dot3 = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

/** Distance from point p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5). */
export function pointTriangleDistance(p: Vec3, a: Vec3, b: Vec3, c: Vec3) {
  const ab = sub3(b, a);
  const ac = sub3(c, a);
  const ap = sub3(p, a);
  const d1 = dot3(ab, ap);
  const d2 = dot3(ac, ap);
  const bp = sub3(p, b);
  const d3 = dot3(ab, bp);
  const d4 = dot3(ac, bp);
  const cp = sub3(p, c);
  const d5 = dot3(ab, cp);
  const d6 = dot3(ac, cp);
  const vc = d1 * d4 - d3 * d2;
  const vb = d5 * d2 - d1 * d6;
  const va = d3 * d6 - d5 * d4;
  // Closest point = a + ab*s + ac*t
  let s = 0;
  let t = 0;
  if (d1 <= 0 && d2 <= 0) {
    // vertex a
  } else if (d3 >= 0 && d4 <= d3) {
    s = 1;
  } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    s = d1 / (d1 - d3);
  } else if (d6 >= 0 && d5 <= d6) {
    t = 1;
  } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    t = d2 / (d2 - d6);
  } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    s = 1 - w;
    t = w;
  } else {
    const denom = 1 / (va + vb + vc);
    s = vb * denom;
    t = vc * denom;
  }
  const q: Vec3 = [
    a[0] + ab[0] * s + ac[0] * t,
    a[1] + ab[1] * s + ac[1] * t,
    a[2] + ab[2] * s + ac[2] * t,
  ];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

function vertex(m: MeshSurface, i: number): Vec3 {
  const at = (k: number) => m.positions[3 * i + k] ?? NaN;
  return [at(0), at(1), at(2)];
}

export function validateClimbAnnotations(
  sub: ClimbSubmission,
  ctx: ValidationContext,
): AnnotationIssue[] {
  const issues: AnnotationIssue[] = [];
  const tol = ctx.tolerance ?? SURFACE_TOLERANCE_M;

  const name = normName(sub.name);
  if (!name)
    issues.push({ code: "name_empty", message: "Climb name is required." });
  else if (ctx.existingNames.some((n) => normName(n) === name))
    issues.push({
      code: "name_duplicate",
      message: `A climb named "${sub.name.trim()}" already exists on this scan.`,
    });

  const starts = sub.holds.filter((h) => h.type === "start").length;
  if (starts < MIN_START_HOLDS || starts > MAX_START_HOLDS)
    issues.push({
      code: "start_holds_count",
      message: `Climbs need ${MIN_START_HOLDS}-${MAX_START_HOLDS} start holds (got ${starts}).`,
    });
  if (sub.holds.length < MIN_TOTAL_HOLDS)
    issues.push({
      code: "too_few_holds",
      message: `Climbs need at least ${MIN_TOTAL_HOLDS} holds (got ${sub.holds.length}).`,
    });

  const ids = new Set<string>();
  const faces = ctx.mesh.indices.length / 3;
  for (const h of sub.holds) {
    if (ids.has(h.id))
      issues.push({
        code: "duplicate_hold_id",
        message: `Hold id ${h.id} is used twice.`,
        holdId: h.id,
      });
    ids.add(h.id);
    if (h.scan_content_hash !== ctx.scanContentHash) {
      issues.push({
        code: "hash_mismatch",
        message: `Hold ${h.id} was placed on a different mesh version than this scan's current one; re-place it.`,
        holdId: h.id,
      });
      continue;
    }
    if (
      !Number.isInteger(h.face_index) ||
      h.face_index < 0 ||
      h.face_index >= faces
    ) {
      issues.push({
        code: "face_out_of_range",
        message: `Hold ${h.id} references face ${h.face_index}, but the mesh has ${faces} faces.`,
        holdId: h.id,
      });
      continue;
    }
    const f = h.face_index * 3;
    const d = pointTriangleDistance(
      h.position,
      vertex(ctx.mesh, ctx.mesh.indices[f] ?? -1),
      vertex(ctx.mesh, ctx.mesh.indices[f + 1] ?? -1),
      vertex(ctx.mesh, ctx.mesh.indices[f + 2] ?? -1),
    );
    if (!Number.isFinite(d) || d > tol)
      issues.push({
        code: "off_surface",
        message: `Hold ${h.id} is ${Number.isFinite(d) ? d.toFixed(3) : "?"} m from its mesh face (tolerance ${tol} m).`,
        holdId: h.id,
      });
  }

  // Sequence: seq_order values, where present, are unique and run 0..k-1.
  const seqs = sub.holds
    .map((h) => h.seq_order)
    .filter((s): s is number => s != null)
    .sort((a, b) => a - b);
  if (seqs.length && !seqs.every((s, i) => s === i))
    issues.push({
      code: "bad_sequence",
      message:
        "Hold sequence (seq_order) must be unique and run 0..n-1 without gaps.",
    });

  return issues;
}

/** Throws {@link AnnotationValidationError} listing every problem found. */
export function assertValidClimbAnnotations(
  sub: ClimbSubmission,
  ctx: ValidationContext,
): void {
  const issues = validateClimbAnnotations(sub, ctx);
  if (issues.length) throw new AnnotationValidationError(issues);
}
