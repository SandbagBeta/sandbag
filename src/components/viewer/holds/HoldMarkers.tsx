"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useCursor } from "@react-three/drei";
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Matrix4,
  Quaternion,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type InstancedMesh,
} from "three";
import type { Hold, HoldType } from "@/lib/types";
import { groupHoldsByType, markerTransform } from "./holdMath";
import {
  DIM_MIX,
  DIM_SCALE,
  DIMMED_COLOR,
  HOLD_STYLE,
  HOLD_TYPES,
  type MarkerShape,
} from "./holdStyle";

/** Marker geometry with its base at y = 0 and the surface normal along +Y. */
function createMarkerGeometry(shape: MarkerShape): BufferGeometry {
  switch (shape) {
    case "ring":
      return new TorusGeometry(0.035, 0.009, 8, 24)
        .rotateX(Math.PI / 2)
        .translate(0, 0.009, 0);
    case "disc":
      return new CylinderGeometry(0.032, 0.032, 0.008, 20).translate(
        0,
        0.004,
        0,
      );
    case "tile":
      return new BoxGeometry(0.05, 0.008, 0.05).translate(0, 0.004, 0);
    case "cone":
      return new ConeGeometry(0.03, 0.06, 16).translate(0, 0.03, 0);
  }
}

export interface HoldMarkersProps {
  holds: Hold[];
  /** null = nothing selected: every hold at full color. */
  selectedClimbId: string | null;
  onSelectClimb?: (climbId: string) => void;
}

/** One InstancedMesh (one draw call) per hold type, whatever the hold count. */
export function HoldMarkers({
  holds,
  selectedClimbId,
  onSelectClimb,
}: HoldMarkersProps) {
  const groups = useMemo(() => groupHoldsByType(holds), [holds]);
  return (
    <group name="hold-markers">
      {HOLD_TYPES.map((type) =>
        groups[type].length > 0 ? (
          <HoldTypeInstances
            key={`${type}-${groups[type].length}`}
            type={type}
            holds={groups[type]}
            selectedClimbId={selectedClimbId}
            onSelectClimb={onSelectClimb}
          />
        ) : null,
      )}
    </group>
  );
}

const DIM = new Color(DIMMED_COLOR);
/** Pointer travel (px) above which a click is an orbit drag, not a pick. */
const CLICK_SLOP = 4;

function HoldTypeInstances({
  type,
  holds,
  selectedClimbId,
  onSelectClimb,
}: HoldMarkersProps & { type: HoldType }) {
  const ref = useRef<InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const style = HOLD_STYLE[type];
  const geometry = useMemo(
    () => createMarkerGeometry(style.shape),
    [style.shape],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    const full = new Color(style.color);
    const dim = full.clone().lerp(DIM, DIM_MIX);
    holds.forEach((hold, i) => {
      const active =
        selectedClimbId === null || hold.climb_id === selectedClimbId;
      const { position, quaternion } = markerTransform(hold);
      m.compose(
        p.fromArray(position),
        q.fromArray(quaternion),
        s.setScalar(active ? 1 : DIM_SCALE),
      );
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, active ? full : dim);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); // raycasting + frustum culling
    invalidate(); // frameloop="demand"
  }, [holds, selectedClimbId, style.color, invalidate]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > CLICK_SLOP || e.instanceId === undefined) return;
    e.stopPropagation();
    const hold = holds[e.instanceId];
    if (hold) onSelectClimb?.(hold.climb_id);
  };

  return (
    <instancedMesh
      ref={ref}
      name={`holds-${type}`}
      args={[geometry, undefined, holds.length]}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
      }}
      onPointerOut={() => setHovered(false)}
    >
      <meshStandardMaterial roughness={0.45} metalness={0} />
    </instancedMesh>
  );
}
