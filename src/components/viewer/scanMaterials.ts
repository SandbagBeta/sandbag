import { DoubleSide, type Material, type Mesh, type Object3D } from "three";

/**
 * Scans are one-sided surfaces: from behind, back faces are culled and the wall
 * disappears. Render both sides, for every viewer (BoulderViewer is the single
 * entry point). A material flag only: geometry, and so the indirect BVH's face
 * numbering that must match the server, is untouched.
 */
export function makeScanDoubleSided(root: Object3D): void {
  root.traverse((o) => {
    const mats = (o as Mesh).material as Material | Material[] | undefined;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      if (m.side === DoubleSide) continue;
      m.side = DoubleSide;
      m.needsUpdate = true;
    }
  });
}
