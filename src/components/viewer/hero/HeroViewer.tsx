"use client";

import { useLayoutEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { demoBoulder } from "@/lib/fixtures";
import { BoulderViewer } from "../BoulderViewer";
import { dominantNormal } from "../fitCamera";
import { ClimbLine } from "../holds/ClimbLine";
import { HoldMarkers } from "../holds/HoldMarkers";

/** The climb highlighted in the hero: the first published fixture climb. */
const HERO_CLIMB_ID = demoBoulder.climbs[0]?.id ?? "";
const noop = () => {};

/** The fit leaves room for orbiting and zooming; the hero crops in tighter. */
const HERO_ZOOM = 1.45;

function HeroFraming() {
  const get = useThree((s) => s.get);
  useLayoutEffect(() => {
    const { camera, invalidate } = get();
    camera.zoom = HERO_ZOOM;
    camera.updateProjectionMatrix();
    invalidate();
  }, [get]);
  return null;
}

export interface HeroViewerProps {
  label: string;
  className?: string;
  /** Stop requesting frames (off-screen or hidden tab). */
  paused?: boolean;
  onReady?: () => void;
}

/**
 * The landing page's decorative 3D scene: the demo boulder slowly turning with
 * its climb line glowing. Reads the committed fixture and `/fixtures/*.glb`
 * only (no Supabase). Scroll never zooms and vertical touch drags still scroll
 * the page. Lazy-load this module (`next/dynamic`, `ssr: false`).
 */
export default function HeroViewer({
  label,
  className,
  paused,
  onReady,
}: HeroViewerProps) {
  const { holds, paths } = demoBoulder;
  const heroHolds = useMemo(
    () => holds.filter((h) => h.climb_id === HERO_CLIMB_ID),
    [holds],
  );
  const heroPaths = useMemo(
    () =>
      paths.filter((p) => p.climb_id === HERO_CLIMB_ID && p.kind === "line"),
    [paths],
  );
  const facing = useMemo(
    () => dominantNormal(heroHolds.map((h) => h.normal)),
    [heroHolds],
  );
  return (
    <BoulderViewer
      src={demoBoulder.scan.public_url}
      label={label}
      className={className}
      chrome="bare"
      facing={facing}
      autoRotate={0.7}
      paused={paused}
      enableZoom={false}
      enablePan={false}
      canvasClassName="!touch-pan-y"
      dpr={[1, 1.5]}
      errorFallback={null}
      onReady={onReady}
      scene={
        <>
          <HeroFraming />
          <HoldMarkers
            holds={heroHolds}
            selectedClimbId={HERO_CLIMB_ID}
            onSelectClimb={noop}
          />
          {heroPaths.map((p) => (
            <ClimbLine key={p.id} path={p} holds={heroHolds} glow />
          ))}
        </>
      }
    />
  );
}
