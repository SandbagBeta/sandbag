import type { ParsedMesh } from "../qc/mesh";
import type { MeshSurface } from "./validate";

/**
 * The surface a climb submission is validated against, in the canonical GLB's
 * own frame: the frame the viewer shows and in which hold positions are stored.
 *
 * QC's `ParsedMesh` stores positions relative to the bounding-box centre (to
 * keep float32 precise), so validating against `mesh.positions` directly would
 * shift every face by that centre and reject honest holds as `off_surface`
 * whenever the GLB is not centred on the origin. This adds the centre back.
 *
 * Face `i` is the global triangle `i` of the concatenated triangle primitives
 * in `flattenDocument` order (the `Hold.face_index` contract, issue #22 B).
 *
 * Server only, with the validator. The centre is a location in the source
 * file's frame: never return, log or serialise it, or this surface.
 */
export function meshSurfaceFromParsed(
  mesh: Pick<ParsedMesh, "positions" | "indices" | "centre">,
): MeshSurface {
  const positions = new Float64Array(mesh.positions.length);
  for (let i = 0; i < positions.length; i++) {
    positions[i] = mesh.positions[i]! + mesh.centre[i % 3]!;
  }
  return { positions, indices: mesh.indices };
}
