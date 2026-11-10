/**
 * OpenBeta client (#27, ADR 001). SERVER ONLY. Read-only GraphQL over
 * `fetch`, one global throttle per server instance, and a Postgres
 * read-through cache with a 7-day soft TTL. Coordinates never pass through
 * here in readable form: see src/lib/location/store.ts (writes) and
 * src/lib/location.ts (reads).
 */
export {
  getArea,
  getClimb,
  refreshArea,
  fetchLeafClimbs,
  searchAreas,
  TTL_MS,
  type AreaView,
  type Cached,
  type OpenBetaOptions,
  type RefreshOutcome,
  type SearchResult,
  type Unavailable,
} from "./cache";
export type { AreaSearchHit, Organization } from "./parse";
export { OpenBetaError, Throttle, type OpenBetaErrorCode } from "./transport";
