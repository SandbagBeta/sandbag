/**
 * OpenBeta GraphQL queries (ADR 001 §6). Facts only: no `content { ... }`
 * prose or location text and no media (ADR §1, §4), and no proximity queries.
 * Coordinate selections come from src/lib/location/store.ts and are spliced
 * in, so this module never names a coordinate field itself.
 */
import {
  AREA_COORDS_SELECTION as AREA_COORDS,
  CLIMB_COORDS_SELECTION as CLIMB_COORDS,
} from "../location/store";

const CLIMB = `uuid name grades { vscale font yds } type { bouldering } ${CLIMB_COORDS}`;

/**
 * Area page, one request per area. Differs from the ADR sketch: it also
 * selects the area's own `climbs`, so a leaf (boulder) page is one request
 * instead of two, and drops `isBoulder` (unreliable, ADR §3), `gradeContext`,
 * `mp_id` and `safety` (no cache column).
 */
export const AREA_DETAIL_QUERY = `query AreaDetail($uuid: ID!) {
  area(uuid: $uuid) {
    uuid areaName pathTokens ancestors totalClimbs
    metadata { leaf } ${AREA_COORDS}
    organizations { orgId orgType displayName content { website } }
    authorMetadata { updatedAt }
    climbs { ${CLIMB} }
    children {
      uuid areaName totalClimbs
      metadata { leaf } ${AREA_COORDS}
      climbs { ${CLIMB} }
    }
  }
}`;

/** Climbs on a leaf area (scheduled refresh jobs). */
export const CLIMBS_IN_AREA_QUERY = `query ClimbsInArea($uuid: ID!) {
  area(uuid: $uuid) { uuid metadata { leaf } climbs { ${CLIMB} } }
}`;

/** Single climb (attach flow, scan page). */
export const CLIMB_BY_ID_QUERY = `query ClimbById($uuid: ID!) {
  climb(uuid: $uuid) { ${CLIMB} parent { uuid } }
}`;

/** Name search. Selects no coordinates: results are names and paths only (D2). */
export const SEARCH_AREAS_QUERY = `query SearchAreas($match: String!) {
  areas(filter: { area_name: { match: $match } }, limit: 10) {
    uuid areaName pathTokens totalClimbs metadata { leaf }
  }
}`;

export const ALL_QUERIES = [
  AREA_DETAIL_QUERY,
  CLIMBS_IN_AREA_QUERY,
  CLIMB_BY_ID_QUERY,
  SEARCH_AREAS_QUERY,
] as const;
