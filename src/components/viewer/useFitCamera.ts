"use client";

import {
  useLayoutEffect,
  useRef,
  type ComponentRef,
  type RefObject,
} from "react";
import type { Vec3 } from "@/lib/types";
import { useThree } from "@react-three/fiber";
import type { OrbitControls } from "@react-three/drei";
import { PerspectiveCamera, type Object3D } from "three";
import {
  computeCameraFit,
  isBehind,
  measureBounds,
  viewDirectionFor,
  type CameraFit,
} from "./fitCamera";

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
  facing: Vec3 | null = null,
) {
  const get = useThree((s) => s.get);
  const facingRef = useRef(facing);
  const fitRef = useRef<CameraFit | null>(null);
  // Declared before the effects below so they read the latest value.
  useLayoutEffect(() => {
    facingRef.current = facing;
  });

  useLayoutEffect(() => {
    const object = objectRef.current;
    if (!object) return;
    // Throws "scan has no geometry" for empty/degenerate meshes; React routes
    // effect errors to the nearest error boundary (ViewerErrorBoundary).
    // A scaled ancestor (the reviewed scale) hasn't rendered yet: bring the
    // world matrices up to date so the box is in displayed units.
    object.updateWorldMatrix(true, true);
    const box = measureBounds(object);

    const { camera, invalidate } = get();
    const fit = computeCameraFit(box, {
      fovDeg: camera instanceof PerspectiveCamera ? camera.fov : 50,
      facing: facingRef.current,
    });
    fitRef.current = fit;

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

  // Selection changed (a different climb, so a different wall): swing round to
  // face it, but only if the camera is behind it. A user who has orbited to the
  // front half keeps their view.
  const facingKey = facing ? facing.map((n) => n.toFixed(2)).join(",") : "";
  useLayoutEffect(() => {
    const fit = fitRef.current;
    if (!fit) return;
    const { camera, invalidate } = get();
    const controls = controlsRef.current;
    const target = controls ? controls.target : fit.target;
    const offset = camera.position.clone().sub(target);
    if (!isBehind(offset, facingRef.current)) return;
    const dir = viewDirectionFor(facingRef.current);
    camera.position.copy(target).addScaledVector(dir, offset.length());
    camera.lookAt(target);
    controls?.update();
    invalidate();
  }, [facingKey, controlsRef, get]);
}
