import { Vector3, type Mesh, type Object3D } from "three";
import type { MeshSurface } from "@/lib/annotations";

/**
 * Flattens the loaded scene into the validator's MeshSurface, in the same
 * traversal order as buildFaceOffsets so face indices line up. Positions are
 * world space, matching picked hold positions.
 */
export function buildMeshSurface(root: Object3D): MeshSurface {
  root.updateWorldMatrix(true, true);
  const positions: number[] = [];
  const indices: number[] = [];
  const v = new Vector3();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute("position");
    if (!pos) return;
    const index = mesh.geometry.index;
    const count = index?.count ?? pos.count;
    if (count < 3) return;
    const base = positions.length / 3;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      positions.push(v.x, v.y, v.z);
    }
    for (let i = 0; i < Math.floor(count / 3) * 3; i++)
      indices.push(base + (index ? index.getX(i) : i));
  });
  return { positions, indices };
}
