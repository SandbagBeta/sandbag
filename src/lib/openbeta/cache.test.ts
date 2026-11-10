// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchLeafClimbs,
  getArea,
  getClimb,
  refreshArea,
  resetOpenBetaState,
  searchAreas,
  TTL_MS,
  type OpenBetaOptions,
} from "./cache";
import { createFakeDb } from "./fake-db";
import {
  CONTRIVED_FACE,
  fakeOpenBeta,
  fixtures,
  HAMMOND_POND,
  PAWTUCKAWAY,
  ROUND_POND,
  TRANSPLANT,
} from "./__fixtures__";
import { ALL_QUERIES } from "./queries";
import { Throttle } from "./transport";

vi.mock("server-only", () => ({}));

const USA = "1db1e8ba-a40e-587c-88a4-64f5ea814b8e";
const NH = "8a63706f-b14c-536f-b8ab-3cea90093e36";
const T0 = new Date("2026-11-10T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

// Every long decimal in the recorded responses: the coordinates, found
// without naming a coordinate field.
const COORD_DIGITS = [
  ...new Set(JSON.stringify(fixtures).match(/-?\d{1,3}\.\d{4,}/g) ?? []),
];

const ALLOWED_AREA_KEYS = [
  "openbeta_area_id",
  "name",
  "path_tokens",
  "ancestors",
  "is_leaf",
  "total_climbs",
  "organizations",
  "openbeta_updated_at",
  "fetched_at",
  "refresh_after",
  "last_error",
  "last_error_at",
  "ancestors_changed_at",
];
const ALLOWED_CLIMB_KEYS = [
  "openbeta_climb_id",
  "openbeta_area_id",
  "name",
  "grades",
  "is_boulder",
  "fetched_at",
  "refresh_after",
  "last_error",
  "last_error_at",
];

let logs: unknown[][];
beforeEach(() => {
  resetOpenBetaState();
  logs = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, m).mockImplementation((...a) => void logs.push(a));
  }
});
afterEach(() => vi.restoreAllMocks());

function setup(areas?: Parameters<typeof fakeOpenBeta>[0]) {
  const db = createFakeDb();
  const api = fakeOpenBeta(areas);
  const clock = { t: T0.getTime() };
  const deferred: (() => Promise<void>)[] = [];
  const opts: OpenBetaOptions = {
    client: db.client,
    fetch: api.fetch,
    throttle: new Throttle(0),
    now: () => new Date(clock.t),
    defer: (task) => void deferred.push(task),
  };
  const flush = async () => {
    while (deferred.length) await deferred.shift()!();
  };
  return { db, api, clock, opts, flush };
}

const area = (db: ReturnType<typeof createFakeDb>, id: string) =>
  db.row("area_cache", id) as Record<string, unknown>;

/** A body for an area with changed fields, derived from a recorded one. */
function variant(
  body: { data: { area: Record<string, unknown> } },
  patch: Record<string, unknown>,
) {
  const b = structuredClone(body);
  Object.assign(b.data.area, patch);
  return b;
}

describe("first visit: synchronous fetch + cache write (Pawtuckaway)", () => {
  it("caches the area with the #29 ancestors / path_tokens contract", async () => {
    const { db, api, opts } = setup();
    const res = await getArea(PAWTUCKAWAY, opts);
    expect(res).toMatchObject({
      status: "ok",
      stale: false,
      fetchedAt: T0.toISOString(),
    });
    expect(api.requests).toEqual([
      { op: "AreaDetail", variables: { uuid: PAWTUCKAWAY } },
    ]);

    const paw = area(db, PAWTUCKAWAY);
    expect(paw.ancestors).toEqual([USA, NH]); // root-first, excludes itself
    expect(paw.path_tokens).toEqual(["USA", "New Hampshire", "Pawtuckaway"]);
    expect(paw.total_climbs).toBe(917);
    expect(paw.organizations).toEqual([
      expect.objectContaining({
        displayName: "Southeast New England Climbers Coalition",
        website: "https://snecc.org",
      }),
    ]);
    expect(paw.openbeta_updated_at).toBe(new Date(1733335194408).toISOString());
    expect(paw.refresh_after).toBe(
      new Date(T0.getTime() + TTL_MS).toISOString(),
    );
    expect(paw.ancestors_changed_at ?? null).toBeNull();

    // Ancestors exist so the privacy resolver can walk the chain (P1),
    // each with a consistent shape, and stale so a visit fetches them fully.
    expect(area(db, USA)).toMatchObject({
      name: "USA",
      ancestors: [],
      path_tokens: ["USA"],
    });
    expect(area(db, NH)).toMatchObject({
      ancestors: [USA],
      path_tokens: ["USA", "New Hampshire"],
    });
    expect(area(db, NH).refresh_after).toBe(T0.toISOString());

    // Children: cached under Pawtuckaway, with their leaf climbs.
    const round = area(db, ROUND_POND);
    expect(round).toMatchObject({
      ancestors: [USA, NH, PAWTUCKAWAY],
      is_leaf: true,
      total_climbs: 75,
    });
    expect(round.path_tokens).toEqual([
      "USA",
      "New Hampshire",
      "Pawtuckaway",
      "Round Pond",
    ]);
    const roundClimbs = db.tables.climb_cache!.filter(
      (c) => c.openbeta_area_id === ROUND_POND,
    );
    expect(roundClimbs).toHaveLength(75);
  });

  it("caches facts only: no prose, location text, media or coordinate keys", async () => {
    const { db, opts } = setup();
    await getArea(PAWTUCKAWAY, opts);
    await getArea(HAMMOND_POND, opts);
    for (const r of db.tables.area_cache!) {
      for (const k of Object.keys(r)) expect(ALLOWED_AREA_KEYS).toContain(k);
    }
    for (const r of db.tables.climb_cache!) {
      for (const k of Object.keys(r)) expect(ALLOWED_CLIMB_KEYS).toContain(k);
    }
    const cached = JSON.stringify([
      db.tables.area_cache,
      db.tables.climb_cache,
    ]);
    for (const d of COORD_DIGITS) expect(cached).not.toContain(d);
    for (const q of ALL_QUERIES) {
      expect(q).not.toMatch(
        /\b(content\s*\{\s*(description|areaLocation|location|protection)|description|areaLocation|protection|media)\b/,
      );
    }
  });

  it("detects boulders from climb.type, keeps only non-null grades", async () => {
    const { db, opts } = setup();
    await getArea(HAMMOND_POND, opts);
    expect(db.row("climb_cache", TRANSPLANT)).toMatchObject({
      openbeta_area_id: CONTRIVED_FACE,
      name: "Transplant",
      grades: { vscale: "V3", font: "6A", yds: "V3" },
      is_boulder: true,
    });
    const route = db.tables.climb_cache!.find(
      (c) => c.name === "Huckleberry Hound",
    );
    expect(route).toBeUndefined(); // Pawtuckaway not fetched here
    await getArea(PAWTUCKAWAY, opts);
    const r = db.tables.climb_cache!.find(
      (c) => c.name === "Huckleberry Hound",
    )!;
    expect(r).toMatchObject({ grades: { yds: "5.9" }, is_boulder: null });
  });

  it("serves a leaf area's climbs from the cache", async () => {
    const { opts } = setup();
    await getArea(HAMMOND_POND, opts);
    const leaf = await getArea(CONTRIVED_FACE, opts);
    expect(leaf.status === "ok" && leaf.data.climbs.map((c) => c.name)).toEqual(
      ["Transplant"],
    );
    // A child cached from its parent's page is served, but flagged stale
    // so its own fetch (organizations, updatedAt) happens in the background.
    expect(leaf.status === "ok" && leaf.stale).toBe(true);
  });

  it("concurrent first visits share one request", async () => {
    const { api, opts } = setup();
    const [a, b] = await Promise.all([
      getArea(HAMMOND_POND, opts),
      getArea(HAMMOND_POND, opts),
    ]);
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    expect(api.requests).toHaveLength(1);
  });
});

describe("TTL: fresh / stale", () => {
  it("fresh rows are served with no request", async () => {
    const { api, clock, opts } = setup();
    await getArea(HAMMOND_POND, opts);
    clock.t += 6 * DAY;
    const res = await getArea(HAMMOND_POND, opts);
    expect(res).toMatchObject({ status: "ok", stale: false });
    expect(api.requests).toHaveLength(1);
  });

  it("stale rows are served immediately and refreshed in the background", async () => {
    const { db, api, clock, opts, flush } = setup();
    await getArea(HAMMOND_POND, opts);
    clock.t += 8 * DAY;
    const res = await getArea(HAMMOND_POND, opts);
    expect(res).toMatchObject({
      status: "ok",
      stale: true,
      fetchedAt: T0.toISOString(),
    });
    expect(api.requests).toHaveLength(1); // not yet
    await flush();
    expect(api.requests).toHaveLength(2);
    expect(area(db, HAMMOND_POND).fetched_at).toBe(
      new Date(clock.t).toISOString(),
    );
    expect(await getArea(HAMMOND_POND, opts)).toMatchObject({ stale: false });
  });

  it("an unchanged authorMetadata.updatedAt skips the area writes", async () => {
    const { db, clock, opts, flush } = setup();
    await getArea(PAWTUCKAWAY, opts);
    const before = structuredClone(area(db, PAWTUCKAWAY));
    db.calls.length = 0;
    clock.t += 8 * DAY;
    await getArea(PAWTUCKAWAY, opts);
    await flush();
    const areaWrites = db.calls.filter(
      (c) => c.table === "area_cache" && c.op !== "select",
    );
    expect(areaWrites).toHaveLength(1);
    expect(areaWrites[0]!.op).toBe("update");
    expect(Object.keys(areaWrites[0]!.rows![0]!).sort()).toEqual([
      "fetched_at",
      "last_error",
      "last_error_at",
      "refresh_after",
    ]);
    const after = area(db, PAWTUCKAWAY);
    expect({ ...after, fetched_at: 0, refresh_after: 0 }).toEqual({
      ...before,
      fetched_at: 0,
      refresh_after: 0,
    });
  });

  it("refreshArea forces a refresh (scheduled job)", async () => {
    const { api, opts } = setup();
    expect(await refreshArea(HAMMOND_POND, opts)).toBe("ok");
    expect(await refreshArea(HAMMOND_POND, opts)).toBe("ok");
    expect(api.requests).toHaveLength(2);
  });
});

describe("re-parenting (P3)", () => {
  const MOVED_TO = "0f0f0f0f-0000-4000-8000-000000000001";

  it("a refresh with different ancestors writes them and sets ancestors_changed_at", async () => {
    const hp = fixtures.areaHammondPond as {
      data: { area: Record<string, unknown> };
    };
    const { db, clock, opts } = setup();
    await getArea(HAMMOND_POND, opts);
    expect(area(db, HAMMOND_POND).ancestors_changed_at ?? null).toBeNull();

    // OpenBeta moves Hammond Pond under a new area.
    const moved = variant(hp, {
      ancestors: [USA, MOVED_TO, HAMMOND_POND],
      pathTokens: ["USA", "Elsewhere", "Hammond Pond"],
    });
    const { opts: opts2 } = setup({ [HAMMOND_POND]: moved });
    clock.t += 8 * DAY;
    const o = { ...opts2, client: db.client, now: opts.now };
    expect(await refreshArea(HAMMOND_POND, o)).toBe("ok");
    const row = area(db, HAMMOND_POND);
    expect(row.ancestors).toEqual([USA, MOVED_TO]);
    expect(row.path_tokens).toEqual(["USA", "Elsewhere", "Hammond Pond"]);
    expect(row.ancestors_changed_at).toBe(new Date(clock.t).toISOString());
    // Its children were cached under the old chain: they are re-parented too.
    expect(area(db, CONTRIVED_FACE)).toMatchObject({
      ancestors: [USA, MOVED_TO, HAMMOND_POND],
      ancestors_changed_at: new Date(clock.t).toISOString(),
    });

    // A later refresh never clears the flag; only a reviewer does (#20).
    const flagged = row.ancestors_changed_at;
    clock.t += 8 * DAY;
    expect(await refreshArea(HAMMOND_POND, o)).toBe("ok");
    expect(area(db, HAMMOND_POND).ancestors_changed_at).toBe(flagged);
  });

  it("the same ancestors never set the flag, and area_privacy is never written", async () => {
    const { db, clock, opts } = setup();
    await getArea(PAWTUCKAWAY, opts);
    clock.t += 8 * DAY;
    await refreshArea(PAWTUCKAWAY, opts);
    expect(
      db.tables.area_cache!.every((r) => r.ancestors_changed_at == null),
    ).toBe(true);
    expect(db.calls.some((c) => c.table === "area_privacy")).toBe(false);
  });
});

describe("graceful degradation", () => {
  const down = (status = 503) =>
    (async () =>
      new Response(
        `<html>upstream near ${COORD_DIGITS.slice(0, 4).join(", ")}</html>`,
        {
          status,
        },
      )) as typeof fetch;

  it("API down: serves the cached row, flags it stale, records a code-only last_error", async () => {
    const { db, clock, opts, flush } = setup();
    await getArea(HAMMOND_POND, opts);
    clock.t += 8 * DAY;
    const o = { ...opts, fetch: down() };
    const res = await getArea(HAMMOND_POND, o);
    expect(res).toMatchObject({
      status: "ok",
      stale: true,
      fetchedAt: T0.toISOString(),
    });
    await flush();
    const row = area(db, HAMMOND_POND);
    expect(row.last_error).toBe("http_503");
    expect(row.last_error_at).toBe(new Date(clock.t).toISOString());
    // Still served, still stale, data unchanged.
    expect(await getArea(HAMMOND_POND, o)).toMatchObject({
      status: "ok",
      stale: true,
    });
    expect(row.name).toBe("Hammond Pond");
    const text = JSON.stringify([row, logs]);
    for (const d of COORD_DIGITS) expect(text).not.toContain(d);
    expect(text).not.toContain("upstream");
  });

  it("a failed refresh stays stale even inside the TTL until a refresh succeeds", async () => {
    const { db, opts } = setup();
    await getArea(HAMMOND_POND, opts);
    await refreshArea(HAMMOND_POND, {
      ...opts,
      fetch: down(500),
      throttle: new Throttle(0),
    });
    expect(area(db, HAMMOND_POND).last_error).toBe("http_500");
    expect(await getArea(HAMMOND_POND, opts)).toMatchObject({ stale: true });
    await refreshArea(HAMMOND_POND, opts);
    expect(area(db, HAMMOND_POND).last_error).toBeNull();
    expect(await getArea(HAMMOND_POND, opts)).toMatchObject({ stale: false });
  });

  it("API down and nothing cached: a typed unavailable result, not a throw", async () => {
    const { opts } = setup();
    const network = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await getArea(HAMMOND_POND, { ...opts, fetch: down() })).toEqual({
      status: "unavailable",
      reason: "openbeta_unavailable",
    });
    expect(
      await getArea(PAWTUCKAWAY, {
        ...opts,
        fetch: network,
        throttle: new Throttle(0),
      }),
    ).toEqual({
      status: "unavailable",
      reason: "openbeta_unavailable",
    });
    expect(
      await getClimb(TRANSPLANT, {
        ...opts,
        fetch: down(),
        throttle: new Throttle(0),
      }),
    ).toMatchObject({
      status: "unavailable",
    });
    const text = JSON.stringify(logs);
    for (const d of COORD_DIGITS) expect(text).not.toContain(d);
  });

  it("unknown areas, bad ids and a failing database are typed results too", async () => {
    const { db, opts } = setup();
    expect(await getArea("0f0f0f0f-0000-4000-8000-0000000000aa", opts)).toEqual(
      {
        status: "unavailable",
        reason: "not_found",
      },
    );
    expect(await getArea("../etc", opts)).toEqual({
      status: "unavailable",
      reason: "invalid_id",
    });
    db.fail("area_cache");
    expect(await getArea(HAMMOND_POND, opts)).toEqual({
      status: "unavailable",
      reason: "cache_error",
    });
  });
});

describe("climbs", () => {
  it("a cached climb is served without a request", async () => {
    const { api, opts } = setup();
    await getArea(HAMMOND_POND, opts);
    const res = await getClimb(TRANSPLANT, opts);
    expect(res).toMatchObject({
      status: "ok",
      data: { name: "Transplant", is_boulder: true },
    });
    expect(api.requests).toHaveLength(1);
  });

  it("an uncached climb whose leaf is uncached caches the leaf first", async () => {
    const hp = fixtures.areaHammondPond as {
      data: {
        area: Record<string, unknown> & { children: Record<string, unknown>[] };
      };
    };
    const child = hp.data.area.children.find((c) => c.uuid === CONTRIVED_FACE)!;
    const leaf = {
      data: {
        area: {
          ...structuredClone(child),
          pathTokens: [
            ...(hp.data.area.pathTokens as string[]),
            "Contrived Face",
          ],
          ancestors: [...(hp.data.area.ancestors as string[]), CONTRIVED_FACE],
          organizations: [],
          authorMetadata: { updatedAt: 1700000000000 },
          children: [],
        },
      },
    };
    const { db, api, opts } = setup({ [CONTRIVED_FACE]: leaf });
    const res = await getClimb(TRANSPLANT, opts);
    expect(res).toMatchObject({
      status: "ok",
      stale: false,
      data: { openbeta_area_id: CONTRIVED_FACE },
    });
    expect(api.requests.map((r) => r.op)).toEqual(["ClimbById", "AreaDetail"]);
    expect(area(db, CONTRIVED_FACE)).toMatchObject({
      ancestors: [...(hp.data.area.ancestors as string[])],
      path_tokens: [...(hp.data.area.pathTokens as string[]), "Contrived Face"],
    });
  });

  it("fetchLeafClimbs parses ClimbsInArea", async () => {
    const { api } = setup();
    const climbs = await fetchLeafClimbs(CONTRIVED_FACE, {
      fetch: api.fetch,
      throttle: new Throttle(0),
    });
    expect(climbs?.map((c) => [c.id, c.areaId, c.isBoulder])).toEqual([
      [TRANSPLANT, CONTRIVED_FACE, true],
    ]);
  });
});

describe("searchAreas", () => {
  it("returns names and paths, memoized for 10 minutes", async () => {
    const { api, clock, opts } = setup();
    const res = await searchAreas("  Hammond   Pond ", opts);
    expect(res).toEqual({
      source: "openbeta",
      incomplete: false,
      hits: [
        {
          id: HAMMOND_POND,
          name: "Hammond Pond",
          pathTokens: ["USA", "Massachusetts", "Eastern, MA", "Hammond Pond"],
          totalClimbs: 209,
          isLeaf: false,
        },
      ],
    });
    expect(api.requests[0]!.variables).toEqual({ match: "Hammond Pond" });
    await searchAreas("hammond pond", opts);
    expect(api.requests).toHaveLength(1);
    clock.t += 11 * 60 * 1000;
    await searchAreas("hammond pond", opts);
    expect(api.requests).toHaveLength(2);
  });

  it("falls back to a name match over the cache, flagged incomplete", async () => {
    const { opts } = setup();
    await getArea(PAWTUCKAWAY, opts);
    const fail = (async () =>
      new Response("", { status: 502 })) as typeof fetch;
    const res = await searchAreas("round", { ...opts, fetch: fail });
    expect(res.source).toBe("cache");
    expect(res.incomplete).toBe(true);
    expect(res.hits.map((h) => h.id)).toEqual([ROUND_POND]);
    expect(await searchAreas("100%_", { ...opts, fetch: fail })).toMatchObject({
      hits: [],
    });
  });
});
