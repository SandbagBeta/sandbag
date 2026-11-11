import type { SupabaseClient } from "@supabase/supabase-js";
import type { Climb, Scan } from "@/lib/types";
import {
  buildAreaTree,
  crumbs,
  findNode,
  type AreaNode,
  type AreaRow,
  type Crumb,
} from "./tree";

/**
 * Data for /areas and /area/[id] (#30). Uses the request's anon/user client,
 * so RLS applies; we also filter on `published` because RLS lets uploaders
 * read their own unpublished scans and these pages are public. Selects names,
 * grades and storage keys only: never coordinates (CLAUDE.md value 1).
 */

export interface BoulderCard {
  id: string;
  /** Published bucket key of the thumbnail, when the scan has one. */
  thumbPath: string | null;
  /** Published climb names, alphabetical (the card's title). */
  climbNames: string[];
  /** Distinct proposed grades of published climbs, easiest first. */
  grades: string[];
}

export interface BrowseIndex {
  tree: AreaNode[];
  /** Published scans not attached to an OpenBeta area yet. */
  unlinked: BoulderCard[];
}

export interface AreaPage {
  id: string;
  name: string;
  breadcrumb: Crumb[];
  children: AreaNode[];
  /** Published scans attached directly to this area. */
  boulders: BoulderCard[];
}

export class BrowseLoadError extends Error {
  constructor(what: string, cause: { message: string }) {
    super(`Could not load ${what}: ${cause.message}`);
    this.name = "BrowseLoadError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type ScanRow = Pick<
  Scan,
  "id" | "openbeta_area_id" | "glb_path" | "content_hash"
>;

/**
 * ADR 002 §3: the thumbnail sits beside the canonical GLB as
 * `{scan_id}/{content_hash}.webp`. Keys that don't follow the layout (the
 * seeded demo) get none rather than a guessed URL.
 */
export function thumbPathFor(scan: ScanRow): string | null {
  const { id, glb_path, content_hash } = scan;
  if (!glb_path || !content_hash) return null;
  return glb_path === `${id}/${content_hash}.glb`
    ? `${id}/${content_hash}.webp`
    : null;
}

/** "V2" < "V10"; non-V grades sort after, alphabetically. */
export function sortGrades(grades: Iterable<string>): string[] {
  const v = (g: string) => {
    const m = /^V(\d+)/i.exec(g);
    return m ? Number(m[1]) : Infinity;
  };
  return [...new Set(grades)].sort((a, b) => v(a) - v(b) || a.localeCompare(b));
}

async function publishedScans(db: SupabaseClient): Promise<ScanRow[]> {
  const res = await db
    .from("scans")
    .select("id, openbeta_area_id, glb_path, content_hash")
    .eq("status", "published")
    .order("created_at", { ascending: false });
  if (res.error) throw new BrowseLoadError("scans", res.error);
  return (res.data ?? []) as ScanRow[];
}

async function cards(
  db: SupabaseClient,
  scans: ScanRow[],
): Promise<BoulderCard[]> {
  if (scans.length === 0) return [];
  const res = await db
    .from("climbs")
    .select("scan_id, name, proposed_grade")
    .in(
      "scan_id",
      scans.map((s) => s.id),
    )
    .eq("status", "published")
    .order("name");
  if (res.error) throw new BrowseLoadError("climbs", res.error);
  type Row = Pick<Climb, "scan_id" | "name" | "proposed_grade">;
  const byScan = new Map<string, Row[]>();
  for (const c of (res.data ?? []) as Row[]) {
    byScan.set(c.scan_id, [...(byScan.get(c.scan_id) ?? []), c]);
  }
  return scans.map((s) => {
    const climbs = byScan.get(s.id) ?? [];
    return {
      id: s.id,
      thumbPath: thumbPathFor(s),
      climbNames: climbs.map((c) => c.name),
      grades: sortGrades(climbs.map((c) => c.proposed_grade)),
    };
  });
}

/** Area rows for every area that holds a scan, plus all their ancestors. */
async function areaRows(
  db: SupabaseClient,
  areaIds: string[],
): Promise<AreaRow[]> {
  if (areaIds.length === 0) return [];
  const cols = "openbeta_area_id, name, path_tokens, ancestors";
  const res = await db
    .from("area_cache")
    .select(cols)
    .in("openbeta_area_id", areaIds);
  if (res.error) throw new BrowseLoadError("areas", res.error);
  return (res.data ?? []) as AreaRow[];
}

function directCounts(scans: ScanRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of scans) {
    if (s.openbeta_area_id) {
      counts.set(s.openbeta_area_id, (counts.get(s.openbeta_area_id) ?? 0) + 1);
    }
  }
  return counts;
}

export async function loadBrowseIndex(
  db: SupabaseClient,
): Promise<BrowseIndex> {
  const scans = await publishedScans(db);
  const counts = directCounts(scans);
  const rows = await areaRows(db, [...counts.keys()]);
  return {
    tree: buildAreaTree(rows, counts),
    unlinked: await cards(
      db,
      scans.filter((s) => !s.openbeta_area_id),
    ),
  };
}

/** Null when the id is malformed or the area has no published scans below it. */
export async function loadAreaPage(
  db: SupabaseClient,
  id: string,
): Promise<AreaPage | null> {
  if (!UUID.test(id)) return null;
  const areaId = id.toLowerCase();
  const scans = await publishedScans(db);
  const counts = directCounts(scans);
  const rows = await areaRows(db, [...counts.keys()]);
  const node = findNode(buildAreaTree(rows, counts), areaId);
  if (!node) return null;

  // Breadcrumb from any descendant row: its chain passes through this area.
  const row =
    rows.find((r) => r.openbeta_area_id === areaId) ??
    rows.find((r) => r.ancestors.includes(areaId));
  const chain = row ? crumbs(row) : [];
  const breadcrumb = chain.slice(
    0,
    chain.findIndex((c) => c.id === areaId) + 1,
  );

  return {
    id: areaId,
    name: node.name,
    breadcrumb,
    children: node.children,
    boulders: await cards(
      db,
      scans.filter((s) => s.openbeta_area_id === areaId),
    ),
  };
}
