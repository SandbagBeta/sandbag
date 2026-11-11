"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Raycaster, Vector2, Vector3, type Camera } from "three";
import { useStore } from "zustand";
import type { HoldType } from "@/lib/types";
import { BoulderViewer, type BoulderViewerProps } from "../BoulderViewer";
import { HoldMarkers } from "../holds/HoldMarkers";
import { useScanGLTF } from "../loaders";
import { AnnotateControls } from "./AnnotateControls";
import { createEditorStore, type HoldPlacement } from "./editorStore";
import { buildFaceOffsets, isClick, pickFromHit } from "./pick";

/** Screen-space radius (px) within which a pointer-down grabs a hold. */
const GRAB_PX = 16;

type Store = ReturnType<typeof createEditorStore>;
type Drag = { id: string; to: HoldPlacement | null };

export interface AnnotateViewerProps extends Omit<
  BoulderViewerProps,
  "scene" | "bvh"
> {
  scanContentHash: string;
}

/**
 * Desktop hold-placement editor (issue #21). Holds live in client state only;
 * saving is a later PR. Lazy-load this module (`next/dynamic`, `ssr: false`).
 */
export function AnnotateViewer({
  scanContentHash,
  children,
  ...viewer
}: AnnotateViewerProps) {
  const [store] = useState(() =>
    createEditorStore({ climbId: "draft", scanContentHash }),
  );
  const holds = useStore(store, (s) => s.holds);
  const canUndo = useStore(store, (s) => s.past.length > 0);
  const canRedo = useStore(store, (s) => s.future.length > 0);
  const [activeType, setActiveType] = useState<HoldType>("hand");
  const [rawSelected, setSelected] = useState<string | null>(null);
  // Undo can remove the selected hold: derive instead of syncing.
  const selectedId = holds.some((h) => h.id === rawSelected)
    ? rawSelected
    : null;
  const { retype, remove, undo, redo } = store.getState();

  return (
    <div className="relative h-full w-full">
      <BoulderViewer
        {...viewer}
        className={`${viewer.className ?? ""} h-full w-full`}
        bvh
        scene={
          <AnnotateScene
            src={viewer.src}
            store={store}
            activeType={activeType}
            selectedId={selectedId}
            onSelect={setSelected}
          />
        }
      >
        {children}
        Click the boulder to place a hold, drag a hold to move it. Keys 1 to 4
        choose the hold type, Delete removes the selected hold, Control+Z
        undoes.
      </BoulderViewer>
      <AnnotateControls
        activeType={activeType}
        onTypeChange={setActiveType}
        selectedId={selectedId}
        holdCount={holds.length}
        canUndo={canUndo}
        canRedo={canRedo}
        onRetype={retype}
        onDelete={remove}
        onUndo={undo}
        onRedo={redo}
      />
    </div>
  );
}

function AnnotateScene({
  src,
  store,
  activeType,
  selectedId,
  onSelect,
}: {
  src: string;
  store: Store;
  activeType: HoldType;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { scene: scan } = useScanGLTF(src);
  const offsets = useMemo(() => buildFaceOffsets(scan), [scan]);
  const holds = useStore(store, (s) => s.holds);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const invalidate = useThree((s) => s.invalidate);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Latest props/three state without re-binding the DOM listeners.
  const live = useRef({ activeType, onSelect, camera, controls });
  useEffect(() => {
    live.current = { activeType, onSelect, camera, controls };
  });

  const shown = useMemo(
    () =>
      drag?.to
        ? holds.map((h) => (h.id === drag.id ? { ...h, ...drag.to } : h))
        : holds,
    [holds, drag],
  );
  const selected = shown.find((h) => h.id === selectedId);

  useEffect(() => {
    const el = gl.domElement;
    const ray = new Raycaster();
    const ndc = new Vector2();
    const tmp = new Vector3();
    let down: { x: number; y: number } | null = null;
    let dragging: Drag | null = null;

    const pick = (e: PointerEvent, camera: Camera): HoldPlacement | null => {
      const r = el.getBoundingClientRect();
      ndc.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(scan, true)[0];
      const p = hit && pickFromHit(hit, offsets);
      return p
        ? { position: p.position, normal: p.normal, face_index: p.faceIndex }
        : null;
    };
    const grab = (e: PointerEvent, camera: Camera): string | null => {
      const r = el.getBoundingClientRect();
      let best: { id: string; d: number } | null = null;
      for (const h of store.getState().holds) {
        tmp.fromArray(h.position).project(camera);
        const d = Math.hypot(
          r.left + ((tmp.x + 1) / 2) * r.width - e.clientX,
          r.top + ((1 - tmp.y) / 2) * r.height - e.clientY,
        );
        if (d <= GRAB_PX && (!best || d < best.d)) best = { id: h.id, d };
      }
      return best?.id ?? null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { camera, controls, onSelect } = live.current;
      down = { x: e.clientX, y: e.clientY };
      const id = grab(e, camera);
      if (!id) return;
      onSelect(id);
      dragging = { id, to: null };
      if (controls) controls.enabled = false; // no orbit while moving a hold
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging || !down || isClick(down, e)) return;
      dragging = { id: dragging.id, to: pick(e, live.current.camera) };
      setDrag(dragging);
      invalidate();
    };
    const onUp = (e: PointerEvent) => {
      if (!down || e.button !== 0) return;
      const { camera, controls, onSelect, activeType } = live.current;
      if (controls) controls.enabled = true;
      if (dragging) {
        // Single store write on release = a single undo step.
        if (dragging.to) store.getState().move(dragging.id, dragging.to);
      } else if (isClick(down, e)) {
        const at = pick(e, camera);
        onSelect(at ? store.getState().place(at, activeType) : null);
      }
      down = dragging = null;
      setDrag(null);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
  }, [gl, scan, offsets, store, invalidate]);

  return (
    <>
      <HoldMarkers holds={shown} selectedClimbId={null} />
      {selected && (
        <mesh position={selected.position}>
          <sphereGeometry args={[0.05, 16, 12]} />
          <meshBasicMaterial color="#f0e442" wireframe />
        </mesh>
      )}
    </>
  );
}
