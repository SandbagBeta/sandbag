"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Raycaster, Vector2, Vector3, type Camera } from "three";
import { useStore } from "zustand";
import type { MeshSurface } from "@/lib/annotations";
import type { HoldType, Vec3 } from "@/lib/types";
import { BoulderViewer, type BoulderViewerProps } from "../BoulderViewer";
import { ClimbLine } from "../holds/ClimbLine";
import { HoldMarkers } from "../holds/HoldMarkers";
import { useScanGLTF } from "../loaders";
import { AnnotateControls } from "./AnnotateControls";
import { createEditorStore, type HoldPlacement } from "./editorStore";
import { buildMeshSurface } from "./meshSurface";
import { buildFaceOffsets, isClick, pickFromHit } from "./pick";
import {
  drawReducer,
  IDLE,
  sequenceLine,
  type DrawKind,
  type DrawState,
} from "./pathDraw";
import { SaveForm } from "./SaveForm";
import { SequencePanel } from "./SequencePanel";

/** Screen-space radius (px) within which a pointer-down grabs a hold. */
const GRAB_PX = 16;

type Store = ReturnType<typeof createEditorStore>;
type Drag = { id: string; to: HoldPlacement | null };

export interface AnnotateViewerProps extends Omit<
  BoulderViewerProps,
  "scene" | "bvh"
> {
  scanContentHash: string;
  /** Set to show the save form (issue #22); omitted on the dev harness. */
  scanId?: string;
}

/**
 * Desktop hold-placement editor (issues #21, #22). State is client-only until
 * the save form calls `saveClimb`. Lazy-load this module (`next/dynamic`,
 * `ssr: false`).
 */
export function AnnotateViewer({
  scanContentHash,
  scanId,
  children,
  ...viewer
}: AnnotateViewerProps) {
  const [store] = useState(() =>
    createEditorStore({ climbId: "draft", scanContentHash }),
  );
  const holds = useStore(store, (s) => s.holds);
  const canUndo = useStore(store, (s) => s.past.length > 0);
  const canRedo = useStore(store, (s) => s.future.length > 0);
  const paths = useStore(store, (s) => s.paths);
  const meta = useStore(store, (s) => s.meta);
  const [draw, drawDispatch] = useReducer(drawReducer, IDLE);
  const [mesh, setMesh] = useState<MeshSurface | null>(null);
  const [activeType, setActiveType] = useState<HoldType>("hand");
  const [rawSelected, setSelected] = useState<string | null>(null);
  // Undo can remove the selected hold: derive instead of syncing.
  const selectedId = holds.some((h) => h.id === rawSelected)
    ? rawSelected
    : null;
  const { retype, remove, undo, redo, reorder, setMeta, setPath } =
    store.getState();

  // Enter commits the drawn path, Escape discards it.
  useEffect(() => {
    if (!draw.kind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        if (draw.kind && draw.points.length >= 2)
          setPath(draw.kind, draw.points);
        drawDispatch({ type: "finish" });
      } else if (e.key === "Escape") drawDispatch({ type: "cancel" });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draw, setPath]);

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
            draw={draw}
            onDrawPoint={(point) => drawDispatch({ type: "append", point })}
            onMesh={setMesh}
          />
        }
      >
        {children}
        Click the boulder to place a hold, drag a hold to move it. Keys 1 to 4
        choose the hold type, Delete removes the selected hold, Control+Z
        undoes.
      </BoulderViewer>
      <SequencePanel
        holds={holds}
        meta={meta}
        scanContentHash={scanContentHash}
        mesh={mesh}
        selectedId={selectedId}
        draw={draw}
        hasPath={(k: DrawKind) => paths.some((p) => p.kind === k)}
        onSelect={setSelected}
        onReorder={reorder}
        onName={(name) => setMeta({ name })}
        onDraw={(kind) => drawDispatch({ type: "start", kind })}
        onClearPath={(kind) => setPath(kind, [])}
      >
        {scanId && (
          <SaveForm
            scanId={scanId}
            scanContentHash={scanContentHash}
            holds={holds}
            paths={paths}
            meta={meta}
            onMeta={setMeta}
            onSelect={setSelected}
          />
        )}
      </SequencePanel>
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
  draw,
  onDrawPoint,
  onMesh,
}: {
  src: string;
  store: Store;
  activeType: HoldType;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  draw: DrawState;
  onDrawPoint: (point: Vec3) => void;
  onMesh: (mesh: MeshSurface) => void;
}) {
  const { scene: scan } = useScanGLTF(src);
  const offsets = useMemo(() => buildFaceOffsets(scan), [scan]);
  const holds = useStore(store, (s) => s.holds);
  const paths = useStore(store, (s) => s.paths);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const invalidate = useThree((s) => s.invalidate);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Latest props/three state without re-binding the DOM listeners.
  const live = useRef({
    activeType,
    onSelect,
    camera,
    controls,
    draw,
    onDrawPoint,
  });
  useEffect(() => {
    live.current = {
      activeType,
      onSelect,
      camera,
      controls,
      draw,
      onDrawPoint,
    };
  });
  useEffect(() => onMesh(buildMeshSurface(scan)), [scan, onMesh]);
  const line = useMemo(
    () => sequenceLine(holds, store.getState().climbId),
    [holds, store],
  );

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
      const id = live.current.draw.kind ? null : grab(e, camera);
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
        const { draw, onDrawPoint } = live.current;
        if (draw.kind) {
          if (at) onDrawPoint(at.position);
        } else onSelect(at ? store.getState().place(at, activeType) : null);
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
      {line && <ClimbLine path={line} holds={shown} />}
      {paths.map((p) => (
        <ClimbLine key={p.id} path={p} holds={shown} />
      ))}
      {draw.kind && (
        <ClimbLine
          path={{
            id: "draft",
            climb_id: store.getState().climbId,
            kind: draw.kind,
            points: draw.points,
          }}
          holds={shown}
        />
      )}
      {selected && (
        <mesh position={selected.position}>
          <sphereGeometry args={[0.05, 16, 12]} />
          <meshBasicMaterial color="#f0e442" wireframe />
        </mesh>
      )}
    </>
  );
}
