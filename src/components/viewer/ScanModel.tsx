"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import type { Group } from "three";
import type { Vec3 } from "@/lib/types";
import { useFitCamera, type OrbitControlsRef } from "./useFitCamera";
import { useScanGLTF } from "./loaders";
import { makeScanDoubleSided } from "./scanMaterials";
import type { CameraFit } from "./fitCamera";

export interface ScanModelProps {
  src: string;
  controlsRef: RefObject<OrbitControlsRef | null>;
  onFit?: (fit: CameraFit) => void;
  /** Outward direction of the scan's dominant surface; the camera faces it. */
  facing?: Vec3 | null;
}

/**
 * Loads a (Draco/meshopt) GLB and fits the camera to it. Suspends while
 * loading; throws to the nearest error boundary on 404 / invalid GLB.
 */
export function ScanModel({
  src,
  controlsRef,
  onFit,
  facing = null,
}: ScanModelProps) {
  const { scene } = useScanGLTF(src);
  const invalidate = useThree((s) => s.invalidate);
  const groupRef = useRef<Group>(null);
  // Before the fit, so the first frame already shows the wall from any side.
  useLayoutEffect(() => {
    makeScanDoubleSided(scene);
    invalidate();
  }, [scene, invalidate]);
  useFitCamera(groupRef, controlsRef, onFit, facing);
  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}
