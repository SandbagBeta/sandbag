import "server-only";
/**
 * Read-through Postgres cache for OpenBeta (ADR 001 "TTL and refresh").
 * SERVER ONLY: writes use the service role.
 *
 * - A cached row is always served. Past `refresh_after` (7 days), a
 *   background refresh goes through the global throttle.
 * - A missing row is fetched synchronously (10 s timeout).
 * - When OpenBeta fails, the cached row is still served, `last_error` gets a
 *   short code (never a body or coordinates), and callers see `stale: true`.
 *   With no cached row, the result is `{ status: "unavailable" }`, not a throw.
 *
 * Privacy contract with src/lib/location.ts (#29): `ancestors` are root-first
 * and exclude the area; `path_tokens` include it; a refresh that changes an
 * area's ancestors sets `ancestors_changed_at` (P3) and nothing here ever
 * clears it or writes `area_privacy`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeAreaCoords, writeClimbCoords } from "../location/store";
import { getPublicSupabaseEnv, getServiceRoleKey } from "../supabase/env";
import type { AreaCache, ClimbCache } from "../types";
import {
  parseAreaDetail,
  parseClimbById,
  parseClimbsInArea,
  parseSearch,
  type AreaNode,
  type AreaSearchHit,
  type ClimbNode,
} from "./parse";
import {
  AREA_DETAIL_QUERY,
  CLIMB_BY_ID_QUERY,
  CLIMBS_IN_AREA_QUERY,
  SEARCH_AREAS_QUERY,
} from "./queries";
import { errorCode, postGraphQL, type TransportOptions } from "./transport";

export const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_TTL_MS = 10 * 60 * 1000;
const SEARCH_MAX_ENTRIES = 200;

export interface OpenBetaOptions extends TransportOptions {
  /** Service-role client; defaults to one built from env. Injected in tests. */
  client?: SupabaseClient;
  now?: () => Date;
  /**
   * Runs a background refresh. Default: fire and forget. In a route handler
   * pass Next's `after` so the work outlives the response on Vercel.
   */
  defer?: (task: () => Promise<void>) => void;
}

export type Unavailable = {
  status: "unavailable";
  reason: "openbeta_unavailable" | "not_found" | "cache_error" | "invalid_id";
};
export type Cached<T> =
  | {
      status: "ok";
      data: T;
      /** Past its TTL or the last refresh failed: show "OpenBeta data as of fetchedAt". */
      stale: boolean;
      fetchedAt: string;
    }
  | Unavailable;

export interface AreaView {
  area: AreaCache;
  /** Cached climbs whose leaf area is this one (empty for non-leaves). */
  climbs: ClimbCache[];
}

export interface SearchResult {
  hits: AreaSearchHit[];
  source: "openbeta" | "cache";
  /** True when served from the name fallback: results may be missing areas. */
  incomplete: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = (reason: Unavailable["reason"]): Unavailable => ({
  status: "unavailable",
  reason,
});

let serviceClient: SupabaseClient | null = null;
function db(opts: OpenBetaOptions): SupabaseClient {
  if (opts.client) return opts.client;
  serviceClient ??= createClient(
    getPublicSupabaseEnv().url,
    getServiceRoleKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return serviceClient;
}

/** A failed cache query. Carries only the PostgREST error code. */
class CacheError extends Error {
  constructor(readonly code: string) {
    super(`[openbeta] cache query failed (${code})`);
  }
}
function check<T>(res: { data: T; error: { code?: string } | null }): T {
  if (res.error) throw new CacheError(res.error.code ?? "unknown");
  return res.data;
}

const now = (opts: OpenBetaOptions) => (opts.now ?? (() => new Date()))();
const stamps = (opts: OpenBetaOptions) => {
  const t = now(opts);
  return {
    fetched_at: t.toISOString(),
    refresh_after: new Date(t.getTime() + TTL_MS).toISOString(),
  };
};
const isStale = (
  row: { refresh_after: string; last_error: string | null },
  opts: OpenBetaOptions,
) =>
  row.last_error != null ||
  Date.parse(row.refresh_after) <= now(opts).getTime();
const sameIds = (a: unknown, b: string[]) =>
  Array.isArray(a) &&
  a.length === b.length &&
  a.every((x, i) => String(x).toLowerCase() === b[i]);

// One in-flight refresh per key, shared by sync and background callers.
const inflight = new Map<string, Promise<RefreshOutcome>>();
export type RefreshOutcome = "ok" | "not_found" | "api_error" | "cache_error";
function once(
  key: string,
  run: () => Promise<RefreshOutcome>,
): Promise<RefreshOutcome> {
  let p = inflight.get(key);
  if (!p) {
    p = run().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}
function background(
  key: string,
  run: () => Promise<RefreshOutcome>,
  o: OpenBetaOptions,
) {
  const task = async () => void (await once(key, run).catch(() => "api_error"));
  (o.defer ?? ((t) => void t()))(task);
}

/** Record a failed refresh on an existing row: a code and a time, nothing else. */
async function markError(
  client: SupabaseClient,
  table: "area_cache" | "climb_cache",
  id: string,
  code: string,
  opts: OpenBetaOptions,
) {
  const key = table === "area_cache" ? "openbeta_area_id" : "openbeta_climb_id";
  console.warn("[openbeta] refresh failed, serving cache", { id, code });
  await client
    .from(table)
    .update({ last_error: code, last_error_at: now(opts).toISOString() })
    .eq(key, id)
    .then(
      () => undefined,
      () => undefined,
    );
}

// --- Writes ----------------------------------------------------------------

function climbRow(c: ClimbNode, t: ReturnType<typeof stamps>) {
  return {
    openbeta_climb_id: c.id,
    openbeta_area_id: c.areaId,
    name: c.name,
    grades: c.grades,
    is_boulder: c.isBoulder,
    ...t,
    last_error: null,
    last_error_at: null,
  };
}

async function writeClimbs(
  client: SupabaseClient,
  climbs: ClimbNode[],
  opts: OpenBetaOptions,
) {
  if (!climbs.length) return;
  const t = stamps(opts);
  check(
    await client.from("climb_cache").upsert(
      climbs.map((c) => climbRow(c, t)),
      { onConflict: "openbeta_climb_id" },
    ),
  );
  await writeClimbCoords(
    client,
    climbs.map((c) => ({ id: c.id, coords: c.coords })),
  );
}

/** Write a fetched area, its ancestors (if missing), children and climbs. */
async function writeArea(
  client: SupabaseClient,
  node: AreaNode,
  existing: AreaCache | null,
  opts: OpenBetaOptions,
) {
  const t = stamps(opts);
  const reparented =
    existing != null && !sameIds(existing.ancestors, node.ancestors);
  const unchanged =
    existing != null &&
    !reparented &&
    existing.openbeta_updated_at != null &&
    node.updatedAt != null &&
    Date.parse(existing.openbeta_updated_at) === Date.parse(node.updatedAt) &&
    existing.name === node.name &&
    existing.total_climbs === node.totalClimbs;

  if (unchanged) {
    // Same authorMetadata.updatedAt: only the bookkeeping changes.
    check(
      await client
        .from("area_cache")
        .update({ ...t, last_error: null, last_error_at: null })
        .eq("openbeta_area_id", node.id),
    );
  } else {
    // Ancestors first, so the privacy resolver can walk the whole chain (P1).
    // Insert-only and already stale: an ancestor's own fetch fills the rest.
    if (node.ancestors.length) {
      const rows = node.ancestors.map((id, i) => ({
        openbeta_area_id: id,
        name: node.pathTokens[i]!,
        path_tokens: node.pathTokens.slice(0, i + 1),
        ancestors: node.ancestors.slice(0, i),
        is_leaf: false,
        fetched_at: t.fetched_at,
        refresh_after: t.fetched_at,
      }));
      check(
        await client.from("area_cache").upsert(rows, {
          onConflict: "openbeta_area_id",
          ignoreDuplicates: true,
        }),
      );
    }
    check(
      await client.from("area_cache").upsert(
        {
          openbeta_area_id: node.id,
          name: node.name,
          path_tokens: node.pathTokens,
          ancestors: node.ancestors,
          is_leaf: node.isLeaf,
          total_climbs: node.totalClimbs,
          organizations: node.organizations,
          openbeta_updated_at: node.updatedAt,
          ...t,
          last_error: null,
          last_error_at: null,
          // P3. Omitted otherwise, so an upsert never clears a reviewer's flag.
          ...(reparented ? { ancestors_changed_at: t.fetched_at } : {}),
        },
        { onConflict: "openbeta_area_id" },
      ),
    );
    await writeChildren(client, node, t);
  }

  const children = node.children;
  await writeClimbs(
    client,
    [...node.climbs, ...children.flatMap((c) => c.climbs)],
    opts,
  );
  await writeAreaCoords(
    client,
    [node, ...children].map((a) => ({ id: a.id, coords: a.coords })),
  );
}

/** Children: insert missing ones (stale, so a visit fetches them fully); re-parent moved ones. */
async function writeChildren(
  client: SupabaseClient,
  node: AreaNode,
  t: ReturnType<typeof stamps>,
) {
  if (!node.children.length) return;
  const ancestors = [...node.ancestors, node.id];
  const existing = new Map(
    (
      check(
        await client
          .from("area_cache")
          .select("openbeta_area_id, ancestors")
          .in(
            "openbeta_area_id",
            node.children.map((c) => c.id),
          ),
      ) ?? []
    ).map((r) => [r.openbeta_area_id as string, r.ancestors as unknown]),
  );
  const fresh = node.children.filter((c) => !existing.has(c.id));
  if (fresh.length) {
    check(
      await client.from("area_cache").upsert(
        fresh.map((c) => ({
          openbeta_area_id: c.id,
          name: c.name,
          path_tokens: [...node.pathTokens, c.name],
          ancestors,
          is_leaf: c.isLeaf,
          total_climbs: c.totalClimbs,
          fetched_at: t.fetched_at,
          refresh_after: t.fetched_at,
        })),
        { onConflict: "openbeta_area_id", ignoreDuplicates: true },
      ),
    );
  }
  for (const c of node.children) {
    if (!existing.has(c.id) || sameIds(existing.get(c.id), ancestors)) continue;
    check(
      await client
        .from("area_cache")
        .update({
          ancestors,
          path_tokens: [...node.pathTokens, c.name],
          ancestors_changed_at: t.fetched_at,
        })
        .eq("openbeta_area_id", c.id),
    );
  }
}

// --- Refresh ----------------------------------------------------------------

async function refreshAreaRow(
  id: string,
  existing: AreaCache | null,
  opts: OpenBetaOptions,
): Promise<RefreshOutcome> {
  const client = db(opts);
  let node: AreaNode | null;
  try {
    node = parseAreaDetail(
      await postGraphQL(AREA_DETAIL_QUERY, { uuid: id }, opts),
    );
  } catch (err) {
    if (existing)
      await markError(client, "area_cache", id, errorCode(err), opts);
    else console.warn("[openbeta] fetch failed", { id, code: errorCode(err) });
    return "api_error";
  }
  if (!node) {
    if (existing) await markError(client, "area_cache", id, "not_found", opts);
    return "not_found";
  }
  try {
    await writeArea(client, node, existing, opts);
    return "ok";
  } catch (err) {
    console.error("[openbeta] cache write failed", {
      id,
      code: (err as { code?: string }).code,
    });
    return "cache_error";
  }
}

async function refreshClimbRow(
  id: string,
  existing: ClimbCache | null,
  opts: OpenBetaOptions,
): Promise<RefreshOutcome> {
  const client = db(opts);
  let climb: ClimbNode | null;
  try {
    climb = parseClimbById(
      await postGraphQL(CLIMB_BY_ID_QUERY, { uuid: id }, opts),
    );
  } catch (err) {
    if (existing)
      await markError(client, "climb_cache", id, errorCode(err), opts);
    return "api_error";
  }
  if (!climb) {
    if (existing) await markError(client, "climb_cache", id, "not_found", opts);
    return "not_found";
  }
  try {
    const parent = check(
      await client
        .from("area_cache")
        .select("openbeta_area_id")
        .eq("openbeta_area_id", climb.areaId)
        .maybeSingle(),
    );
    // climb_cache references area_cache: cache the leaf (and its chain) first.
    if (!parent) {
      const out = await once(`area:${climb.areaId}`, () =>
        refreshAreaRow(climb.areaId, null, opts),
      );
      if (out !== "ok") return out === "not_found" ? "api_error" : out;
    }
    await writeClimbs(client, [climb], opts);
    return "ok";
  } catch {
    return "cache_error";
  }
}

// --- Public API -------------------------------------------------------------

async function readThrough<
  R extends {
    fetched_at: string;
    refresh_after: string;
    last_error: string | null;
  },
  T,
>(
  key: string,
  read: () => Promise<R | null>,
  refresh: (existing: R | null) => Promise<RefreshOutcome>,
  view: (row: R) => Promise<T>,
  opts: OpenBetaOptions,
): Promise<Cached<T>> {
  try {
    let row = await read();
    if (row) {
      const cached = row;
      if (isStale(cached, opts)) background(key, () => refresh(cached), opts);
    } else {
      const out = await once(key, () => refresh(null));
      if (out === "api_error") return unavailable("openbeta_unavailable");
      if (out !== "ok") return unavailable(out);
      row = await read();
      if (!row) return unavailable("cache_error");
    }
    return {
      status: "ok",
      data: await view(row),
      stale: isStale(row, opts),
      fetchedAt: row.fetched_at,
    };
  } catch {
    return unavailable("cache_error");
  }
}

/** An OpenBeta area (and its cached climbs), read through the cache. Never throws. */
export function getArea(
  areaId: string,
  opts: OpenBetaOptions = {},
): Promise<Cached<AreaView>> {
  if (!UUID.test(areaId)) return Promise.resolve(unavailable("invalid_id"));
  const id = areaId.toLowerCase();
  const client = () => db(opts);
  return readThrough(
    `area:${id}`,
    async () =>
      check(
        await client()
          .from("area_cache")
          .select("*")
          .eq("openbeta_area_id", id)
          .maybeSingle(),
      ) as AreaCache | null,
    (existing) => refreshAreaRow(id, existing, opts),
    async (area) => ({
      area,
      climbs: (check(
        await client()
          .from("climb_cache")
          .select("*")
          .eq("openbeta_area_id", id),
      ) ?? []) as ClimbCache[],
    }),
    opts,
  );
}

/** An OpenBeta climb, read through the cache. Never throws. */
export function getClimb(
  climbId: string,
  opts: OpenBetaOptions = {},
): Promise<Cached<ClimbCache>> {
  if (!UUID.test(climbId)) return Promise.resolve(unavailable("invalid_id"));
  const id = climbId.toLowerCase();
  return readThrough(
    `climb:${id}`,
    async () =>
      check(
        await db(opts)
          .from("climb_cache")
          .select("*")
          .eq("openbeta_climb_id", id)
          .maybeSingle(),
      ) as ClimbCache | null,
    (existing) => refreshClimbRow(id, existing, opts),
    async (climb) => climb,
    opts,
  );
}

/** Force a refresh now (scheduled weekly job). Deduplicated with read-through refreshes. */
export async function refreshArea(
  areaId: string,
  opts: OpenBetaOptions = {},
): Promise<RefreshOutcome> {
  if (!UUID.test(areaId)) return "not_found";
  const id = areaId.toLowerCase();
  return once(`area:${id}`, async () => {
    try {
      const existing = check(
        await db(opts)
          .from("area_cache")
          .select("*")
          .eq("openbeta_area_id", id)
          .maybeSingle(),
      ) as AreaCache | null;
      return await refreshAreaRow(id, existing, opts);
    } catch {
      return "cache_error";
    }
  });
}

/** Climbs on a leaf area, straight from OpenBeta (uncached; for refresh jobs). */
export async function fetchLeafClimbs(
  areaId: string,
  opts: TransportOptions = {},
) {
  return parseClimbsInArea(
    await postGraphQL(CLIMBS_IN_AREA_QUERY, { uuid: areaId }, opts),
  );
}

const searchMemo = new Map<string, { at: number; hits: AreaSearchHit[] }>();

/**
 * Area name search. Memoized in process for 10 minutes, not cached in
 * Postgres (ADR). When OpenBeta fails, falls back to a name match over
 * cached areas and flags the result `incomplete`. Never throws.
 */
export async function searchAreas(
  match: string,
  opts: OpenBetaOptions = {},
): Promise<SearchResult> {
  const q = match.trim().replace(/\s+/g, " ").slice(0, 100);
  if (q.length < 2) return { hits: [], source: "openbeta", incomplete: false };
  const key = q.toLowerCase();
  const t = now(opts).getTime();
  const memo = searchMemo.get(key);
  if (memo && t - memo.at < SEARCH_TTL_MS) {
    return { hits: memo.hits, source: "openbeta", incomplete: false };
  }
  try {
    const hits = parseSearch(
      await postGraphQL(SEARCH_AREAS_QUERY, { match: q }, opts),
    );
    searchMemo.delete(key);
    searchMemo.set(key, { at: t, hits });
    if (searchMemo.size > SEARCH_MAX_ENTRIES) {
      searchMemo.delete(searchMemo.keys().next().value!);
    }
    return { hits, source: "openbeta", incomplete: false };
  } catch {
    try {
      const rows = check(
        await db(opts)
          .from("area_cache")
          .select("openbeta_area_id, name, path_tokens, total_climbs, is_leaf")
          .ilike("name", `%${q.replace(/[\\%_]/g, "\\$&")}%`)
          .limit(10),
      ) as
        | Pick<
            AreaCache,
            | "openbeta_area_id"
            | "name"
            | "path_tokens"
            | "total_climbs"
            | "is_leaf"
          >[]
        | null;
      const hits = (rows ?? []).map((r) => ({
        id: r.openbeta_area_id,
        name: r.name,
        pathTokens: r.path_tokens,
        totalClimbs: r.total_climbs,
        isLeaf: r.is_leaf,
      }));
      return { hits, source: "cache", incomplete: true };
    } catch {
      return { hits: [], source: "cache", incomplete: true };
    }
  }
}

/** TEST ONLY: forget in-process state between tests. */
export function resetOpenBetaState() {
  inflight.clear();
  searchMemo.clear();
}
