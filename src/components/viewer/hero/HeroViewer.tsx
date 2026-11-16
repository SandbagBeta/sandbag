"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { demoBoulder } from "@/lib/fixtures";
import { BoulderViewer } from "../BoulderViewer";
import { dominantNormal } from "../fitCamera";
import { ClimbLine } from "../holds/ClimbLine";
import { HoldMarkers } from "../holds/HoldMarkers";
import {
  activeClimbIndex,
  planSweep,
  sweepAzimuth,
  type SweepPlan,
} from "./sweep";

const noop = () => {};

/** The fit leaves room for orbiting and zooming; the hero crops in tighter. */
const HERO_ZOOM = 1.45;

/** One full swing (left, right, back) takes this long. */
const SWEEP_PERIOD_S = 18;

const UP = new Vector3(0, 1, 0);

/** The caption for the climb currently facing the camera. */
export interface HeroClimb {
  name: string;
  grade: string | null;
}

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

interface OrbitLike {
  target: Vector3;
  update: () => void;
}

/**
 * Swings the camera back and forth around the boulder so each climb's face
 * passes in front of it, and reports which climb is currently facing us.
 * `ready` waits for the scan to be fitted, which positions the camera first.
 */
function SweepCamera({
  plan,
  ready,
  onActive,
}: {
  plan: SweepPlan;
  ready: boolean;
  onActive: (index: number) => void;
}) {
  const controls = useThree((s) => s.controls) as OrbitLike | null;
  const phase = useRef({ t: 0, active: 0 });
  useFrame((state, delta) => {
    if (!ready || !controls) return;
    // Clamp so a long pause (off-screen, hidden tab) resumes smoothly.
    phase.current.t += Math.min(delta, 0.05) * ((2 * Math.PI) / SWEEP_PERIOD_S);
    const want = sweepAzimuth(plan, phase.current.t);
    const { camera } = state;
    const offset = camera.position.clone().sub(controls.target);
    const current = Math.atan2(offset.x, offset.z);
    offset.applyAxisAngle(UP, want - current);
    camera.position.copy(controls.target).add(offset);
    controls.update();
    const next = activeClimbIndex(plan, want, phase.current.active);
    if (next !== phase.current.active) {
      phase.current.active = next;
      onActive(next);
    }
  });
  return null;
}

export interface HeroViewerProps {
  label: string;
  className?: string;
  /** Stop requesting frames (off-screen or hidden tab). */
  paused?: boolean;
  onReady?: () => void;
  /** Called when a different climb comes to face the camera (and once at start). */
  onActiveClimb?: (climb: HeroClimb) => void;
}

/**
 * The landing page's decorative 3D scene: the demo boulder swinging side to
 * side so each of its climbs comes to the front, with that climb's line
 * glowing. Reads the committed fixture and `/fixtures/*.glb` only (no
 * Supabase). It cannot be dragged or zoomed, so page scroll is never trapped.
 * Lazy-load this module (`next/dynamic`, `ssr: false`).
 */
export default function HeroViewer({
  label,
  className,
  paused,
  onReady,
  onActiveClimb,
}: HeroViewerProps) {
  const { climbs, holds, paths } = demoBoulder;
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(0);

  const plan = useMemo(
    () =>
      planSweep(
        climbs.map((c) =>
          dominantNormal(
            holds.filter((h) => h.climb_id === c.id).map((h) => h.normal),
          ),
        ),
      ),
    [climbs, holds],
  );
  const facing = useMemo(
    () =>
      [Math.sin(plan.center), 0, Math.cos(plan.center)] as [
        number,
        number,
        number,
      ],
    [plan],
  );

  const climb = climbs[active] ?? climbs[0];
  const heroHolds = useMemo(
    () => holds.filter((h) => h.climb_id === climb?.id),
    [holds, climb],
  );
  const heroPaths = useMemo(
    () => paths.filter((p) => p.climb_id === climb?.id && p.kind === "line"),
    [paths, climb],
  );

  useEffect(() => {
    if (climb)
      onActiveClimb?.({ name: climb.name, grade: climb.proposed_grade });
  }, [climb, onActiveClimb]);

  return (
    <BoulderViewer
      src={demoBoulder.scan.public_url}
      label={label}
      className={className}
      chrome="bare"
      facing={facing}
      animating
      paused={paused}
      enableRotate={false}
      enableZoom={false}
      enablePan={false}
      canvasClassName="!touch-pan-y"
      dpr={[1, 1.5]}
      errorFallback={null}
      onReady={() => {
        setReady(true);
        onReady?.();
      }}
      scene={
        <>
          <HeroFraming />
          <SweepCamera plan={plan} ready={ready} onActive={setActive} />
          <HoldMarkers
            holds={heroHolds}
            selectedClimbId={climb?.id ?? null}
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
