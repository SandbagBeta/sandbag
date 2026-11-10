"use client";

import { useRef, type RefObject } from "react";
import type { Group } from "three";
import { useFitCamera, type OrbitControlsRef } from "./useFitCamera";
import { useScanGLTF } from "./loaders";
import type { CameraFit } from "./fitCamera";

export interface ScanModelProps {
  src: string;
  controlsRef: RefObject<OrbitControlsRef | null>;
  onFit?: (fit: CameraFit) => void;
}

/**
 * Loads a (Draco/meshopt) GLB and fits the camera to it. Suspends while
 * loading; throws to the nearest error boundary on 404 / invalid GLB.
 */
export function ScanModel({ src, controlsRef, onFit }: ScanModelProps) {
  const { scene } = useScanGLTF(src);
  const groupRef = useRef<Group>(null);
  useFitCamera(groupRef, controlsRef, onFit);
  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}
