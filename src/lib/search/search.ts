import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBrowseIndex } from "@/lib/browse/load";
import type { AreaNode } from "@/lib/browse/tree";
import type { Climb } from "@/lib/types";
import { gradesInRange, terms, toTsQuery, type SearchParams } from "./query";

/**
 * Search over published data (#31). Climbs: Postgres full-text search on
 * `climbs.name` (prefix terms, `simple` config, so names aren't stemmed)
 * plus an optional V-grade range. Areas: name match over areas that contain
 * published scans. Request client, so RLS applies; `published` is filtered
 * explicitly too. Names and grades only: never coordinates.
 */

export const RESULT_LIMIT = 50;

export interface ClimbHit {
  id: string;
  scanId: string;
  name: string;
  grade: string;
}

export interface AreaHit {
  id: string;
  name: string;
  scanCount: number;
}

export interface SearchResults {
  climbs: ClimbHit[];
  areas: AreaHit[];
  /** True when there was nothing to search for (empty query and no range). */
  empty: boolean;
}

export class SearchError extends Error {
  constructor(cause: { message: string }) {
    super(`Search failed: ${cause.message}`);
    this.name = "SearchError";
  }
}

function matchAreas(tree: AreaNode[], words: string[]): AreaHit[] {
  const hits: AreaHit[] = [];
  const walk = (nodes: AreaNode[]) => {
    for (const n of nodes) {
      const name = n.name.toLowerCase();
      if (words.every((w) => name.includes(w))) {
        hits.push({ id: n.id, name: n.name, scanCount: n.scanCount });
      }
      walk(n.children);
    }
  };
  walk(tree);
  return hits
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, RESULT_LIMIT);
}

export async function search(
  db: SupabaseClient,
  params: SearchParams,
): Promise<SearchResults> {
  const tsquery = toTsQuery(params.q);
  const grades = gradesInRange(params.minV, params.maxV);
  if (!tsquery && !grades) return { climbs: [], areas: [], empty: true };

  // RLS also shows creators their own climbs, including a published climb
  // whose scan was later taken down, so require a published scan as well.
  let query = db
    .from("climbs")
    .select("id, scan_id, name, proposed_grade, scans!inner(status)")
    .eq("status", "published")
    .eq("scans.status", "published");
  if (tsquery) query = query.textSearch("name", tsquery, { config: "simple" });
  if (grades) query = query.in("proposed_grade", grades);
  const res = await query.order("name").limit(RESULT_LIMIT);
  if (res.error) throw new SearchError(res.error);

  const rows = (res.data ?? []) as Pick<
    Climb,
    "id" | "scan_id" | "name" | "proposed_grade"
  >[];
  // A grade filter narrows climbs; areas have no grade, so skip them then.
  const areas =
    tsquery && !grades
      ? matchAreas((await loadBrowseIndex(db)).tree, terms(params.q))
      : [];

  return {
    climbs: rows.map((c) => ({
      id: c.id,
      scanId: c.scan_id,
      name: c.name,
      grade: c.proposed_grade,
    })),
    areas,
    empty: false,
  };
}
