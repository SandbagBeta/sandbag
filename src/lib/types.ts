/**
 * Provisional types for the 3D layer. Issue #3 (schema v1) reconciles these
 * against the migrations; do not extend without an issue.
 *
 * Shapes mirror docs/PRD.md §8 (`climbs`, `holds`, `paths`). Everything here is
 * mesh-local geometry in the canonical GLB's coordinate frame (Y-up, meters,
 * ground at y = 0). Nothing in this file carries geographic location; coordinates
 * of real places only ever flow through the location-privacy formatter (PRD §2).
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
  seq_order?: number;
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
export type ClimbStatus =
  | "uploaded"
  | "processing"
  | "failed_qc"
  | "pending_review"
  | "published"
  | "rejected";

export interface Climb {
  id: string;
  scan_id: string;
  name: string;
  description: string;
  /** V-scale, e.g. "V4". Community votes live in `grade_votes`, not here. */
  proposed_grade: string;
  /** First-ascent info, free text. */
  fa_info?: string;
  status: ClimbStatus;
  /** Profile id of the contributor who created the climb. */
  created_by: string;
}
