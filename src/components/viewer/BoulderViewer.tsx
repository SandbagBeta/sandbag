"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Vec3 } from "@/lib/types";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bvh, Grid, OrbitControls } from "@react-three/drei";
import type { OrbitControlsRef } from "./useFitCamera";
import { ScanModel } from "./ScanModel";
import { ViewerErrorBoundary } from "./ViewerErrorBoundary";
import { LoadingOverlay } from "./LoadingOverlay";
import { clearScanGLTF } from "./loaders";
import type { CameraFit } from "./fitCamera";
import { ScanDiagonalContext, ScanScaleContext } from "./holds/markerSize";
import { safeScaleFactor } from "./holds/markerScale";

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
  /** Build a BVH over the scan so per-pointer-move raycasts stay cheap (annotation). */
  bvh?: boolean;
  /**
   * The scan's reviewed scale (`scans.scale_factor`): real size = GLB size *
   * scale. Applied to the scene group at render time only; hold positions and
   * face numbers stay in the GLB frame. Default 1.
   */
  scale?: number;
  /**
   * Outward direction of the scan's dominant surface (mean hold normal). The
   * camera opens on that side; when it changes (a different climb is selected)
   * a camera left behind the wall swings round, one already in front stays put.
   */
  facing?: Vec3 | null;
  /**
   * Decorative embeds (the landing hero): transparent background, no ground
   * grid, no loading overlay. Default "full".
   */
  chrome?: "full" | "bare";
  /**
   * OrbitControls autoRotate speed (2 is one turn per 30 s at 60 fps); 0 or
   * omitted is off. Because the frameloop is "demand", rotating keeps asking
   * for frames; `paused` stops that (off-screen, hidden tab).
   */
  autoRotate?: number;
  paused?: boolean;
  /** Wheel/pinch zoom. Turn off where the canvas sits inside a scrolling page. */
  enableZoom?: boolean;
  enablePan?: boolean;
  /** Replaces the Canvas's default `touch-none`. */
  canvasClassName?: string;
  dpr?: [number, number];
  /** Rendered instead of the error panel when the scan fails to load. */
  errorFallback?: ReactNode;
  /** Called once the scan is loaded and the camera is fitted. */
  onReady?: () => void;
}

/** Keeps a demand-mode canvas rendering while it is animating. */
function FrameDriver({ active }: { active: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useFrame(() => {
    if (active) invalidate();
  });
  useEffect(() => {
    if (active) invalidate();
  }, [active, invalidate]);
  return null;
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
  bvh = false,
  scale = 1,
  facing = null,
  chrome = "full",
  autoRotate = 0,
  paused = false,
  enableZoom = true,
  enablePan = true,
  canvasClassName = "touch-none",
  dpr = [1, 2],
  errorFallback,
  onReady,
}: BoulderViewerProps) {
  const bare = chrome === "bare";
  const rotating = autoRotate > 0 && !paused;
  const scaleFactor = safeScaleFactor(scale);
  const controlsRef = useRef<OrbitControlsRef | null>(null);
  const [fit, setFit] = useState<CameraFit | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (fit) onReady?.();
  }, [fit, onReady]);

  const handleRetry = useCallback(() => {
    clearScanGLTF(src);
    setFit(null);
    setAttempt((n) => n + 1);
  }, [src]);

  return (
    <div
      className={`relative overflow-hidden ${bare ? "" : "bg-stone-100 dark:bg-stone-900"} ${className}`}
    >
      <ViewerErrorBoundary
        key={attempt}
        onRetry={handleRetry}
        fallback={errorFallback}
      >
        <Canvas
          role="img"
          aria-label={label}
          className={canvasClassName}
          frameloop="demand"
          dpr={dpr}
          shadows={false}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          camera={{ fov: 50, near: 0.05, far: 200, position: [3, 2, 4] }}
        >
          <hemisphereLight args={["#e8eef7", "#6b5f4e", 1.1]} />
          <directionalLight position={[4, 6, 3]} intensity={1.6} />
          <directionalLight position={[-3, 2, -4]} intensity={0.4} />
          <Suspense fallback={null}>
            {/* key: a new scale remounts so the camera refits to the new size. */}
            <group key={scaleFactor} scale={scaleFactor}>
              {bvh ? (
                // `indirect` keeps the geometry's index buffer in file order. The
                // default BVH reorders it in place, so a hit's faceIndex would no
                // longer match the server's face numbering (flattenDocument) and
                // every hold would be rejected off_surface.
                <Bvh firstHitOnly indirect>
                  <ScanModel
                    src={src}
                    controlsRef={controlsRef}
                    onFit={setFit}
                    facing={facing}
                  />
                </Bvh>
              ) : (
                <ScanModel
                  src={src}
                  controlsRef={controlsRef}
                  onFit={setFit}
                  facing={facing}
                />
              )}
              <ScanScaleContext.Provider value={scaleFactor}>
                <ScanDiagonalContext.Provider
                  value={fit ? fit.radius * 2 : null}
                >
                  {scene}
                </ScanDiagonalContext.Provider>
              </ScanScaleContext.Provider>
            </group>
          </Suspense>
          {fit && !bare && (
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
          <FrameDriver active={rotating} />
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enableDamping
            dampingFactor={0.08}
            enablePan={enablePan}
            enableZoom={enableZoom}
            autoRotate={rotating}
            autoRotateSpeed={autoRotate}
            rotateSpeed={0.8}
            zoomSpeed={0.8}
            minPolarAngle={0.05}
            maxPolarAngle={Math.PI / 2 - 0.02}
          />
        </Canvas>
        {!fit && !bare && <LoadingOverlay />}
      </ViewerErrorBoundary>
      {children && <div className="sr-only">{children}</div>}
    </div>
  );
}
