"use client";

import { createContext, useContext, useEffect } from "react";
import { create } from "zustand";
import {
  DEFAULT_SIZE_PERCENT,
  MAX_SIZE_PERCENT,
  MIN_SIZE_PERCENT,
  SIZE_STEP_PERCENT,
  clampSizePercent,
  effectiveMarkerScale,
} from "./markerScale";

export const MARKER_SIZE_KEY = "sandbag:marker-size:v1";

function readStored(): number {
  try {
    const raw = window.localStorage.getItem(MARKER_SIZE_KEY);
    return raw === null ? DEFAULT_SIZE_PERCENT : clampSizePercent(raw);
  } catch {
    return DEFAULT_SIZE_PERCENT;
  }
}

interface MarkerSizeState {
  percent: number;
  /** Load the saved value (after mount, so server and client markup match). */
  hydrate: () => void;
  setPercent: (percent: number) => void;
}

/** Viewer interaction state (zustand per project rules); persisted best-effort. */
export const useMarkerSize = create<MarkerSizeState>((set) => ({
  percent: DEFAULT_SIZE_PERCENT,
  hydrate: () => set({ percent: readStored() }),
  setPercent: (value) => {
    const percent = clampSizePercent(value);
    set({ percent });
    try {
      window.localStorage.setItem(MARKER_SIZE_KEY, String(percent));
    } catch {
      /* storage blocked or full: the slider still works for this session */
    }
  },
}));

/** Scan bounding-box diagonal, provided inside the Canvas by BoulderViewer. */
export const ScanDiagonalContext = createContext<number | null>(null);

/** Scale for marker geometry, offsets and line dashes in the current scene. */
export function useMarkerScale(): number {
  const diagonal = useContext(ScanDiagonalContext);
  const percent = useMarkerSize((s) => s.percent);
  return effectiveMarkerScale(diagonal, percent);
}

/** DOM slider, for the viewer and annotate side panels. */
export function MarkerSizeSlider({ className = "" }: { className?: string }) {
  const percent = useMarkerSize((s) => s.percent);
  const setPercent = useMarkerSize((s) => s.setPercent);
  const hydrate = useMarkerSize((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  return (
    <label className={`block text-sm ${className}`}>
      Marker size: {percent}%
      <input
        type="range"
        min={MIN_SIZE_PERCENT}
        max={MAX_SIZE_PERCENT}
        step={SIZE_STEP_PERCENT}
        value={percent}
        onChange={(e) => setPercent(Number(e.target.value))}
        className="mt-1 block w-full"
      />
    </label>
  );
}
