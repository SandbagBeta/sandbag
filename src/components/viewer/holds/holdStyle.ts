import type { HoldType } from "@/lib/types";

/** 3D marker geometry per hold type (see `createMarkerGeometry`). */
export type MarkerShape = "ring" | "disc" | "tile" | "cone";

export interface HoldStyle {
  label: string;
  /** Okabe–Ito palette: distinguishable under the common color-vision deficiencies. */
  color: string;
  /** Shape is the redundant (non-color) cue, so hue never carries meaning alone. */
  shape: MarkerShape;
  /** DOM glyph matching the shape (decorative; the label carries the meaning). */
  glyph: string;
}

export const HOLD_TYPES: readonly HoldType[] = [
  "start",
  "hand",
  "foot",
  "finish",
];

export const HOLD_STYLE: Record<HoldType, HoldStyle> = {
  start: { label: "Start", color: "#009e73", shape: "ring", glyph: "◯" },
  hand: { label: "Hand", color: "#56b4e9", shape: "disc", glyph: "●" },
  foot: { label: "Foot", color: "#e69f00", shape: "tile", glyph: "■" },
  finish: { label: "Finish", color: "#cc79a7", shape: "cone", glyph: "▲" },
};

/** Holds of unselected climbs are mixed toward this gray and shrunk (still clickable). */
export const DIMMED_COLOR = "#8c8781";
export const DIM_MIX = 0.7;
export const DIM_SCALE = 0.7;

/** The selected climb's line. Yellow is unused by markers and reads on rock. */
export const CLIMB_LINE_COLOR = "#f0e442";
