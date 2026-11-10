"use client";

import { useProgress } from "@react-three/drei";

/** DOM overlay (outside the canvas) showing GLTF download progress. */
export function LoadingOverlay() {
  const { progress, active } = useProgress();
  const pct = active ? Math.round(progress) : 0;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-stone-100/80 text-stone-700 backdrop-blur-sm dark:bg-stone-900/80 dark:text-stone-300"
    >
      <div className="h-1 w-40 overflow-hidden rounded bg-stone-300 dark:bg-stone-700">
        <div
          className="bg-sandstone h-full transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-sm">Loading scan… {pct}%</p>
    </div>
  );
}
