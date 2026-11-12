import { createHash } from "node:crypto";
import type { Climb, ClimbPath, Hold } from "@/lib/types";
import { LICENSE_TEXT, type BoulderExportInput } from "./boulder";

/**
 * Whole-corpus dataset export (issue #33), the machine-learning counterpart of
 * the per-boulder zip. Pure: takes already-fetched published rows and returns
 * the files to write. Documented in docs/dataset.md.
 *
 * Privacy (PRD §2): every record is rebuilt from an explicit field list, so a
 * `select *` that grows a column (a user id, a coordinate) can never leak into
 * the dataset. Geometry is mesh-local. Contributor handles appear only in
 * ATTRIBUTION.txt, never next to a record.
 */

/** Bump on any breaking change to the layout; documented in docs/dataset.md. */
export const DATASET_SCHEMA_VERSION = 1;

export type DatasetScanInput = Pick<
  BoulderExportInput,
  "scan" | "climbs" | "holds" | "paths" | "glb" | "contributors"
>;

export interface DatasetFile {
  path: string;
  data: Uint8Array;
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const enc = (s: string) => new TextEncoder().encode(s);
const json = (v: unknown) => enc(JSON.stringify(v, null, 2) + "\n");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const climbRecord = (c: Climb) => ({
  id: c.id,
  scan_id: c.scan_id,
  name: c.name,
  description: c.description,
  proposed_grade: c.proposed_grade,
  fa_info: c.fa_info,
});

const holdRecord = (h: Hold) => ({
  id: h.id,
  climb_id: h.climb_id,
  scan_content_hash: h.scan_content_hash,
  position: h.position,
  normal: h.normal,
  face_index: h.face_index,
  type: h.type,
  seq_order: h.seq_order ?? null,
});

const pathRecord = (p: ClimbPath) => ({
  id: p.id,
  climb_id: p.climb_id,
  kind: p.kind,
  points: p.points,
});

export function buildDatasetFiles(
  scans: readonly DatasetScanInput[],
  exportedAt: string,
): DatasetFile[] {
  const files: DatasetFile[] = [];
  const manifestScans: Record<string, unknown>[] = [];
  const labels: string[] = [];
  const handles = new Set<string>();
  const seen = new Set<string>();
  let climbCount = 0;
  let holdCount = 0;

  // Stable order, so two exports of the same data differ only in exported_at.
  const ordered = [...scans].sort((a, b) => a.scan.id.localeCompare(b.scan.id));
  for (const input of ordered) {
    const { scan, glb } = input;
    if (!UUID.test(scan.id) || seen.has(scan.id)) {
      throw new Error("scan id must be a unique uuid");
    }
    seen.add(scan.id);
    if (!scan.content_hash || sha256(glb) !== scan.content_hash) {
      throw new Error(
        `GLB bytes do not match content_hash for scan ${scan.id}`,
      );
    }
    const climbIds = new Set(input.climbs.map((c) => c.id));
    for (const h of input.holds) {
      if (
        h.scan_content_hash !== scan.content_hash ||
        !climbIds.has(h.climb_id)
      ) {
        throw new Error(`hold ${h.id} is not anchored to scan ${scan.id}`);
      }
    }
    for (const p of input.paths) {
      if (!climbIds.has(p.climb_id)) {
        throw new Error(`path ${p.id} does not belong to scan ${scan.id}`);
      }
    }

    const dir = `scans/${scan.id}`;
    const holds = input.holds.map(holdRecord);
    files.push(
      { path: `${dir}/mesh.glb`, data: glb },
      { path: `${dir}/climbs.json`, data: json(input.climbs.map(climbRecord)) },
      { path: `${dir}/holds.json`, data: json(holds) },
      { path: `${dir}/paths.json`, data: json(input.paths.map(pathRecord)) },
    );
    for (const h of holds) {
      labels.push(JSON.stringify({ scan_id: scan.id, ...h }));
    }
    for (const c of input.contributors) handles.add(c.handle);
    climbCount += input.climbs.length;
    holdCount += holds.length;
    manifestScans.push({
      id: scan.id,
      directory: dir,
      glb_file: `${dir}/mesh.glb`,
      content_hash: scan.content_hash,
      tri_count: scan.tri_count,
      texture_res: scan.texture_res,
      capture_app: scan.capture_app,
      captured_at: scan.captured_at,
      openbeta_area_id: scan.openbeta_area_id,
      openbeta_climb_id: scan.openbeta_climb_id,
      climb_count: input.climbs.length,
      hold_count: holds.length,
    });
  }

  const manifest = {
    schema_version: DATASET_SCHEMA_VERSION,
    exported_at: exportedAt,
    license: "CC-BY-SA-4.0",
    counts: { scans: ordered.length, climbs: climbCount, holds: holdCount },
    scans: manifestScans,
  };
  const attribution = [...handles].sort();
  return [
    { path: "manifest.json", data: json(manifest) },
    { path: "labels.jsonl", data: enc(labels.map((l) => l + "\n").join("")) },
    ...files,
    { path: "LICENSE.txt", data: enc(LICENSE_TEXT) },
    {
      path: "ATTRIBUTION.txt",
      data: enc(
        `Contributors (CC BY-SA 4.0):\n${attribution.map((h) => `- ${h}`).join("\n")}\n`,
      ),
    },
  ];
}
