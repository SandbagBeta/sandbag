import {
  getArea,
  searchAreas,
  type AreaSearchHit,
  type OpenBetaOptions,
} from "../openbeta";

/**
 * Attach-flow lookups (#28): the data behind the upload typeahead. Returns
 * names, ids and area paths only. Coordinates are never selected here; any
 * location display goes through src/lib/location.ts.
 */

export interface AttachArea {
  id: string;
  name: string;
  path: string;
  climbCount: number | null;
}
export interface AttachClimb {
  id: string;
  name: string;
  grade: string | null;
}
export type AttachResult<T> =
  { ok: true; items: T[]; incomplete: boolean } | { ok: false; error: string };

const UNAVAILABLE = {
  ok: false as const,
  error: "OpenBeta isn't reachable right now. Try again in a moment.",
};

export function toAttachArea(hit: AreaSearchHit): AttachArea {
  return {
    id: hit.id,
    name: hit.name,
    // The area itself is the last token; show only its ancestors as context.
    path: hit.pathTokens.slice(0, -1).join(" › "),
    climbCount: hit.totalClimbs,
  };
}

export async function searchAttachAreas(
  query: string,
  opts?: OpenBetaOptions,
): Promise<AttachResult<AttachArea>> {
  const res = await searchAreas(query, opts);
  return {
    ok: true,
    items: res.hits.slice(0, 10).map(toAttachArea),
    incomplete: res.incomplete,
  };
}

/** Climbs of one area. The read-through also caches the area, which the scan's FK needs. */
export async function listAttachClimbs(
  areaId: string,
  opts?: OpenBetaOptions,
): Promise<AttachResult<AttachClimb>> {
  const res = await getArea(areaId, opts);
  if (res.status !== "ok") return UNAVAILABLE;
  const items = res.data.climbs
    .map((c) => ({
      id: c.openbeta_climb_id,
      name: c.name,
      grade: c.grades.vscale ?? Object.values(c.grades)[0] ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, items, incomplete: res.stale };
}
