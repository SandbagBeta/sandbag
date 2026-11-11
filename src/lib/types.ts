/**
 * Shared row types. These mirror schema v1
 * (supabase/migrations/20261110000000_schema_v1.sql, issue #3) and PRD §8.
 * Change them only together with a migration.
 *
 * 3D-layer geometry is mesh-local, in the canonical GLB's frame (Y-up, meters,
 * ground at y = 0). Nothing in this file carries geographic location. Raw
 * coordinates live in the locked-down `*_coords` tables and only ever leave the
 * server through the location-privacy formatter (PRD §2, ADR 001), so they get
 * no types here.
 */

/** `[x, y, z]` in meters, in the canonical GLB's frame. */
export type Vec3 = [number, number, number];

export type HoldType = "start" | "hand" | "foot" | "finish";

/**
 * A hold anchored to the mesh surface (PRD §7 "Hold anchoring"): position +
 * face index + normal on the *canonical* GLB, versioned by that GLB's content
 * hash so re-processing the mesh invalidates annotations cleanly.
 */
export interface Hold {
  id: string;
  climb_id: string;
  /** sha256 (hex) of the canonical GLB bytes this hold was placed on. */
  scan_content_hash: string;
  position: Vec3;
  /** Unit outward surface normal at `position`. */
  normal: Vec3;
  /** Triangle index into the mesh primitive's index buffer (`indices[3i..3i+2]`). */
  face_index: number;
  type: HoldType;
  /** Optional ordering along the climb (0-based), when the sequence matters. */
  seq_order?: number | null;
}

export type PathKind = "line" | "topout" | "downclimb";

/** A polyline drawn on the mesh: the climbing line, the topout, or the downclimb. */
export interface ClimbPath {
  id: string;
  climb_id: string;
  kind: PathKind;
  /** Ordered points on the mesh surface, same frame as {@link Hold.position}. */
  points: Vec3[];
}

/** Shared scan/climb lifecycle (PRD §8); transitions go through the lifecycle module only. */
export type LifecycleStatus =
  | "uploaded"
  | "processing"
  | "failed_qc"
  | "pending_review"
  | "published"
  | "rejected";

export type ClimbStatus = LifecycleStatus;
export type ScanStatus = LifecycleStatus;

export interface Climb {
  id: string;
  scan_id: string;
  name: string;
  description: string;
  /** V-scale, e.g. "V4". Community votes live in `grade_votes`, not here. */
  proposed_grade: string;
  /** First-ascent info, free text. */
  fa_info?: string | null;
  /** Set by a DB trigger when the scan mesh is replaced; holds must be re-placed (#26). Null when current. */
  annotations_stale_at?: string | null;
  status: ClimbStatus;
  /** Profile id of the contributor who created the climb; null once their account is deleted. */
  created_by: string | null;
}

export type TrustLevel = "contributor" | "reviewer" | "maintainer";

export interface Profile {
  /** Same id as the Supabase auth user. */
  id: string;
  handle: string;
  trust_level: TrustLevel;
  created_at: string;
}

export interface Scan {
  id: string;
  /** Null once the uploader's account is deleted (contributions are kept). */
  uploader_id: string | null;
  openbeta_area_id: string | null;
  openbeta_climb_id: string | null;
  status: ScanStatus;
  /**
   * When the scan last entered `processing`; null in every other status. Set
   * by a database trigger, never written by the app.
   */
  processing_started_at: string | null;
  /** Storage keys (ADR 002). Never contain names, slugs or coordinates. */
  raw_path: string | null;
  glb_path: string | null;
  /** sha256 (hex) of the canonical GLB. Required once published. */
  content_hash: string | null;
  tri_count: number | null;
  texture_res: number | null;
  qc_report: QcReport | null;
  capture_app: string | null;
  captured_at: string | null;
  license: "CC-BY-SA-4.0";
  created_at: string;
}

/**
 * QC check outcome (ADR 003). `error` checks that fail send the scan to
 * `failed_qc`; failing `warning`/`info` checks still pass to review.
 */
export type QcSeverity = "error" | "warning" | "info";

export interface QcCheckResult {
  /** Stable check id, e.g. "tri_count". */
  id: string;
  pass: boolean;
  severity: QcSeverity;
  /** Human-readable, shown to the contributor. */
  message: string;
  /**
   * Scalar measurements only (counts, ratios, sizes in m or px). No strings,
   * so no file/node/image names or EXIF can ride along.
   */
  data?: Readonly<Record<string, number | boolean>>;
}

/** Size of the mesh's bounding box in metres. Extents only, never corners. */
export interface QcExtents {
  width: number;
  height: number;
  depth: number;
}

/**
 * `scans.qc_report` (ADR 003 §5). Published scan rows are public in full, so
 * this is an allow-list: it deliberately has no fields for min/max corners,
 * coordinates or offsets, EXIF, file names, or node/material/image names.
 * The lifecycle module refuses reports with any other key.
 */
export interface QcReport {
  /** Version of the QC pipeline (and its pinned toolchain) that produced this. */
  pipeline_version: string;
  checks: QcCheckResult[];
  /** Bounding-box extents of the canonical mesh, when it could be measured. */
  extents_m?: QcExtents | null;
  /** Whether the canonical GLB was recentred. Never the offset itself. */
  recentred?: boolean;
}

export interface GradeVote {
  climb_id: string;
  user_id: string;
  grade: string;
  created_at: string;
}

export type ReviewSubject = "scan" | "climb" | "area";
export type ReviewVerdict = "approve" | "request_changes" | "reject";

export interface Review {
  id: string;
  subject_type: ReviewSubject;
  /** scans.id, climbs.id, or an OpenBeta area id (clears re-parenting, P3). */
  subject_id: string;
  /** Null once the reviewer's account is deleted. */
  reviewer_id: string | null;
  verdict: ReviewVerdict;
  /** Required unless the verdict is "approve". */
  reason: string | null;
  created_at: string;
}

export type LocationPrivacy = "exact" | "fuzzed_1km" | "hidden";

/** SandBag-owned privacy flag. Inherits down the area tree (ADR 001). */
export interface AreaPrivacy {
  openbeta_area_id: string;
  location_privacy: LocationPrivacy;
  reason: string;
  set_by: string | null;
  set_at: string;
}

/** Cached OpenBeta area facts. Names and paths are public (ADR 001 D2). */
export interface AreaCache {
  openbeta_area_id: string;
  name: string;
  path_tokens: string[];
  /** Root-first ancestor ids, excluding the area itself. */
  ancestors: string[];
  is_leaf: boolean | null;
  total_climbs: number | null;
  organizations: unknown[];
  openbeta_updated_at: string | null;
  fetched_at: string;
  refresh_after: string;
  last_error: string | null;
  last_error_at: string | null;
  /** Non-null means hidden until a reviewer clears it (ADR 001 P3). */
  ancestors_changed_at: string | null;
}

export interface ClimbCache {
  openbeta_climb_id: string;
  openbeta_area_id: string;
  name: string;
  grades: Record<string, string>;
  is_boulder: boolean | null;
  fetched_at: string;
  refresh_after: string;
  last_error: string | null;
  last_error_at: string | null;
}

/** A verdict notice for the author of a reviewed scan or climb (issue #19). */
export interface Notification {
  id: string;
  user_id: string;
  /** The review that caused it; verdict and reason are read from `reviews`. */
  review_id: string;
  created_at: string;
  /** Null until the user marks it read. */
  read_at: string | null;
}
