/**
 * Typed accessor for the demo boulder fixture (issue #8).
 *
 * The GLB lives at `public/fixtures/demo-boulder.glb` (served at
 * `/fixtures/demo-boulder.glb`); this JSON describes the climbs annotated on
 * it. Both are produced by `pnpm fixtures:generate` — never hand-edit the JSON,
 * since every hold is pinned to the GLB's content hash and face indices.
 */
import type { Climb, ClimbPath, Hold } from "@/lib/types";
import raw from "./demo-boulder.json";

/**
 * Fixture-only scan metadata: the PRD §8 `scans` columns the viewer needs,
 * plus `public_url`. The real `Scan` type lands with the schema (issue #3).
 */
export interface DemoScan {
  id: string;
  uploader_id: string;
  status: "published";
  /** Object path inside the `published` storage bucket (what `pnpm seed` uploads). */
  glb_path: string;
  /** Where Next.js serves the same bytes from `public/` in dev. */
  public_url: string;
  /** sha256 (hex) of the GLB bytes; every hold's `scan_content_hash` matches it. */
  content_hash: string;
  tri_count: number;
  /** Vertex colors only — no texture. */
  texture_res: null;
  capture_app: string;
  license: "CC-BY-SA-4.0";
}

export interface DemoFixture {
  scan: DemoScan;
  climbs: Climb[];
  holds: Hold[];
  paths: ClimbPath[];
}

export const demoBoulder: DemoFixture = raw as DemoFixture;

/** Holds for one climb, in `seq_order`. */
export function holdsForClimb(climbId: string, fixture = demoBoulder): Hold[] {
  return fixture.holds
    .filter((h) => h.climb_id === climbId)
    .sort((a, b) => (a.seq_order ?? 0) - (b.seq_order ?? 0));
}

export function pathsForClimb(
  climbId: string,
  fixture = demoBoulder,
): ClimbPath[] {
  return fixture.paths.filter((p) => p.climb_id === climbId);
}
