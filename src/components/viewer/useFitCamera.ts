"use client";

import { useLayoutEffect, type ComponentRef, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import type { OrbitControls } from "@react-three/drei";
import { Box3, PerspectiveCamera, type Object3D } from "three";
import { computeCameraFit, type CameraFit } from "./fitCamera";

/** Imperative OrbitControls instance (three-stdlib) behind drei's component. */
export type OrbitControlsRef = ComponentRef<typeof OrbitControls>;

/**
 * Measure `objectRef` once mounted, then move the camera and constrain the
 * OrbitControls so the scan fills the view and can't be orbited under ground.
 * Calls `onFit` with the computed fit (used to place the ground grid).
 */
export function useFitCamera(
  objectRef: RefObject<Object3D | null>,
  controlsRef: RefObject<OrbitControlsRef | null>,
  onFit?: (fit: CameraFit) => void,
) {
  const get = useThree((s) => s.get);

  useLayoutEffect(() => {
    const object = objectRef.current;
    if (!object) return;
    const box = new Box3().setFromObject(object, true);
    if (box.isEmpty()) return;

    const { camera, invalidate } = get();
    const fit = computeCameraFit(box, {
      fovDeg: camera instanceof PerspectiveCamera ? camera.fov : 50,
    });

    camera.position.copy(fit.position);
    camera.near = fit.near;
    camera.far = fit.far;
    camera.lookAt(fit.target);
    camera.updateProjectionMatrix();

    const controls = controlsRef.current;
    if (controls) {
      controls.target.copy(fit.target);
      controls.minDistance = fit.minDistance;
      controls.maxDistance = fit.maxDistance;
      controls.maxPolarAngle = fit.maxPolarAngle;
      controls.update();
    }

    onFit?.(fit);
    invalidate();
  }, [objectRef, controlsRef, get, onFit]);
}
