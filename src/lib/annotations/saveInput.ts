import { gradeRank } from "../grades/vScale";
import type { HoldType, PathKind, Vec3 } from "../types";
import type { AnnotationIssue } from "./validate";

/**
 * Untrusted payload of a climb save (issue #22). Parsed here, never cast: only
 * the fields below survive, so nothing extra reaches the database function.
 * All geometry is mesh-local (see types.ts); no geographic coordinates.
 */

export interface SaveHold {
  id: string;
  position: Vec3;
  normal: Vec3;
  face_index: number;
  type: HoldType;
  seq_order: number | null;
}

export interface SavePath {
  kind: PathKind;
  points: Vec3[];
}

export interface SaveClimbInput {
  scanId: string;
  /** Present: replace the holds and paths of this own pending climb. */
  climbId: string | null;
  /** The mesh version the holds were placed on (`scans.content_hash`). */
  scanContentHash: string;
  name: string;
  description: string;
  proposedGrade: string;
  faInfo: string | null;
  holds: SaveHold[];
  paths: SavePath[];
}

export const LIMITS = {
  name: 120,
  description: 2000,
  faInfo: 500,
  holds: 200,
  pathPoints: 5000,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const HOLD_TYPES: readonly HoldType[] = ["start", "hand", "foot", "finish"];
const PATH_KINDS: readonly PathKind[] = ["line", "topout", "downclimb"];
/** Tolerance on |normal| = 1; the viewer's normals are float32. */
const UNIT_TOLERANCE = 0.05;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function vec3(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  if (!v.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return [v[0], v[1], v[2]] as Vec3;
}

export type ParseResult =
  | { ok: true; input: SaveClimbInput }
  | { ok: false; issues: AnnotationIssue[] };

export function parseSaveClimbInput(raw: unknown): ParseResult {
  const issues: AnnotationIssue[] = [];
  const bad = (message: string, holdId?: string) =>
    issues.push({
      code: "bad_payload",
      message,
      ...(holdId ? { holdId } : {}),
    });

  if (!isObj(raw))
    return {
      ok: false,
      issues: [
        { code: "bad_payload", message: "Request body must be an object." },
      ],
    };

  const scanId =
    typeof raw.scanId === "string" && UUID.test(raw.scanId) ? raw.scanId : null;
  if (!scanId) bad("scanId must be a uuid.");
  const climbId =
    raw.climbId == null
      ? null
      : typeof raw.climbId === "string" && UUID.test(raw.climbId)
        ? raw.climbId
        : undefined;
  if (climbId === undefined) bad("climbId must be a uuid or null.");
  const scanContentHash =
    typeof raw.scanContentHash === "string" && HASH.test(raw.scanContentHash)
      ? raw.scanContentHash
      : null;
  if (!scanContentHash)
    bad("scanContentHash must be a 64-character lowercase hex string.");

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name.length > LIMITS.name)
    bad(`name must be at most ${LIMITS.name} characters.`);
  const description =
    typeof raw.description === "string"
      ? raw.description.trim()
      : raw.description == null
        ? ""
        : null;
  if (description === null || description.length > LIMITS.description)
    bad(
      `description must be text of at most ${LIMITS.description} characters.`,
    );
  const proposedGrade =
    typeof raw.proposedGrade === "string"
      ? raw.proposedGrade.trim().toUpperCase()
      : "";
  if (gradeRank(proposedGrade) === null)
    bad("proposedGrade must be a V-scale grade (VB, V0..V17).");
  const faInfo =
    raw.faInfo == null || raw.faInfo === ""
      ? null
      : typeof raw.faInfo === "string"
        ? raw.faInfo.trim()
        : undefined;
  if (
    faInfo === undefined ||
    (faInfo !== null && faInfo.length > LIMITS.faInfo)
  )
    bad(`faInfo must be text of at most ${LIMITS.faInfo} characters.`);

  const holds: SaveHold[] = [];
  if (!Array.isArray(raw.holds) || raw.holds.length > LIMITS.holds) {
    bad(`holds must be an array of at most ${LIMITS.holds}.`);
  } else {
    for (const h of raw.holds) {
      const id =
        isObj(h) &&
        typeof h.id === "string" &&
        h.id.length > 0 &&
        h.id.length <= 64
          ? h.id
          : null;
      if (!isObj(h) || !id) {
        bad("Every hold needs an id (1-64 characters).");
        continue;
      }
      const position = vec3(h.position);
      const normal = vec3(h.normal);
      const faceOk =
        typeof h.face_index === "number" &&
        Number.isInteger(h.face_index) &&
        h.face_index >= 0;
      const typeOk = HOLD_TYPES.includes(h.type as HoldType);
      const seq = h.seq_order == null ? null : h.seq_order;
      const seqOk =
        seq === null ||
        (typeof seq === "number" && Number.isInteger(seq) && seq >= 0);
      if (!position) bad("position must be three finite numbers.", id);
      if (!normal) bad("normal must be three finite numbers.", id);
      else if (Math.abs(Math.hypot(...normal) - 1) > UNIT_TOLERANCE)
        bad("normal must be a unit vector.", id);
      if (!faceOk) bad("face_index must be a non-negative integer.", id);
      if (!typeOk) bad(`type must be one of ${HOLD_TYPES.join(", ")}.`, id);
      if (!seqOk) bad("seq_order must be a non-negative integer or null.", id);
      if (position && normal && faceOk && typeOk && seqOk)
        holds.push({
          id,
          position,
          normal,
          face_index: h.face_index as number,
          type: h.type as HoldType,
          seq_order: seq,
        });
    }
  }

  const paths: SavePath[] = [];
  if (!Array.isArray(raw.paths) || raw.paths.length > PATH_KINDS.length) {
    bad("paths must be an array with at most one path per kind.");
  } else {
    for (const p of raw.paths) {
      const kindOk = isObj(p) && PATH_KINDS.includes(p.kind as PathKind);
      const points =
        isObj(p) &&
        Array.isArray(p.points) &&
        p.points.length >= 2 &&
        p.points.length <= LIMITS.pathPoints
          ? p.points.map(vec3)
          : null;
      if (!isObj(p) || !kindOk || !points || points.some((q) => q === null)) {
        bad(
          `Each path needs a kind (${PATH_KINDS.join(", ")}) and 2-${LIMITS.pathPoints} points of three finite numbers.`,
        );
        continue;
      }
      paths.push({ kind: p.kind as PathKind, points: points as Vec3[] });
    }
    if (new Set(paths.map((p) => p.kind)).size !== paths.length)
      bad("At most one path per kind.");
  }

  if (issues.length || !scanId || !scanContentHash)
    return { ok: false, issues };
  return {
    ok: true,
    input: {
      scanId,
      climbId: climbId ?? null,
      scanContentHash,
      name,
      description: description ?? "",
      proposedGrade,
      faInfo: faInfo ?? null,
      holds,
      paths,
    },
  };
}
