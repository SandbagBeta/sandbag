"use client";

import { Suspense, useCallback, useRef, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import type { OrbitControlsRef } from "./useFitCamera";
import { ScanModel } from "./ScanModel";
import { ViewerErrorBoundary } from "./ViewerErrorBoundary";
import { LoadingOverlay } from "./LoadingOverlay";
import { clearScanGLTF } from "./loaders";
import type { CameraFit } from "./fitCamera";

export interface BoulderViewerProps {
  /** Absolute http(s) or root-relative URL of a compressed GLB. */
  src: string;
  /** Accessible name for the 3D canvas (e.g. "3D scan of Demo Boulder"). */
  label: string;
  className?: string;
  /** Visually hidden text alternative (description, climb list, ...). */
  children?: ReactNode;
  /**
   * Extra r3f content rendered inside the Canvas in world space, mounted with
   * the model (e.g. hold markers). Imperative updates must `invalidate()`.
   */
  scene?: ReactNode;
}

/**
 * Orbit/pan/zoom viewer for a single boulder scan.
 * All imperative three.js lives in this folder; callers just pass a URL.
 */
export function BoulderViewer({
  src,
  label,
  className = "",
  children,
  scene,
}: BoulderViewerProps) {
  const controlsRef = useRef<OrbitControlsRef | null>(null);
  const [fit, setFit] = useState<CameraFit | null>(null);
  const [attempt, setAttempt] = useState(0);

  const handleRetry = useCallback(() => {
    clearScanGLTF(src);
    setFit(null);
    setAttempt((n) => n + 1);
  }, [src]);

  return (
    <div
      className={`relative overflow-hidden bg-stone-100 dark:bg-stone-900 ${className}`}
    >
      <ViewerErrorBoundary key={attempt} onRetry={handleRetry}>
        <Canvas
          role="img"
          aria-label={label}
          className="touch-none"
          frameloop="demand"
          dpr={[1, 2]}
          shadows={false}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          camera={{ fov: 50, near: 0.05, far: 200, position: [3, 2, 4] }}
        >
          <hemisphereLight args={["#e8eef7", "#6b5f4e", 1.1]} />
          <directionalLight position={[4, 6, 3]} intensity={1.6} />
          <directionalLight position={[-3, 2, -4]} intensity={0.4} />
          <Suspense fallback={null}>
            <ScanModel src={src} controlsRef={controlsRef} onFit={setFit} />
            {scene}
          </Suspense>
          {fit && (
            <Grid
              position={[fit.target.x, fit.groundY - 0.002, fit.target.z]}
              args={[fit.radius * 8, fit.radius * 8]}
              cellSize={0.25}
              sectionSize={1}
              cellColor="#9a948b"
              sectionColor="#6f6a62"
              fadeDistance={fit.radius * 8}
              fadeStrength={1.5}
            />
          )}
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enableDamping
            dampingFactor={0.08}
            enablePan
            enableZoom
            rotateSpeed={0.8}
            zoomSpeed={0.8}
            minPolarAngle={0.05}
            maxPolarAngle={Math.PI / 2 - 0.02}
          />
        </Canvas>
        {!fit && <LoadingOverlay />}
      </ViewerErrorBoundary>
      {children && <div className="sr-only">{children}</div>}
    </div>
  );
}
