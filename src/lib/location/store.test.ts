// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAreaLocation, getClimbLocation } from "../location";
import { getArea, refreshArea, resetOpenBetaState } from "../openbeta/cache";
import { createFakeDb } from "../openbeta/fake-db";
import {
  CONTRIVED_FACE,
  fakeOpenBeta,
  fixtures,
  HAMMOND_POND,
  PAWTUCKAWAY,
  ROUND_POND,
  TRANSPLANT,
} from "../openbeta/__fixtures__";
import { parseAreaDetail } from "../openbeta/parse";
import * as queries from "../openbeta/queries";
import { Throttle } from "../openbeta/transport";
import { parseBbox, takeAreaCoords, writeAreaCoords } from "./store";

vi.mock("server-only", () => ({}));

const NH = "8a63706f-b14c-536f-b8ab-3cea90093e36";
type RawArea = {
  uuid: string;
  metadata: { lat: number; lng: number; bbox: number[] | null };
  children: RawArea[];
  climbs: { uuid: string; metadata: { lat: number; lng: number } }[];
};
const raw = (f: unknown) => (f as { data: { area: RawArea } }).data.area;
const HP_RAW = raw(fixtures.areaHammondPond);
const PAW_RAW = raw(fixtures.areaPawtuckaway);

beforeEach(() => resetOpenBetaState());
afterEach(() => vi.restoreAllMocks());

function setup() {
  const db = createFakeDb();
  const api = fakeOpenBeta();
  return {
    db,
    opts: {
      client: db.client,
      fetch: api.fetch,
      throttle: new Throttle(0),
      defer: () => {},
    },
  };
}

describe("bbox corner order", () => {
  it("the recorded responses are [minLng, minLat, maxLng, maxLat] with the centroid inside", () => {
    for (const a of [HP_RAW, PAW_RAW]) {
      const [w, s, e, n] = a.metadata.bbox!;
      expect(w).toBeLessThan(e!);
      expect(s).toBeLessThan(n!);
      // Longitudes are negative in New England, latitudes ~42-43.
      expect(w).toBeLessThan(-70);
      expect(s).toBeGreaterThan(40);
      expect(a.metadata.lng).toBeGreaterThanOrEqual(w!);
      expect(a.metadata.lng).toBeLessThanOrEqual(e!);
      expect(a.metadata.lat).toBeGreaterThanOrEqual(s!);
      expect(a.metadata.lat).toBeLessThanOrEqual(n!);
      expect(parseBbox(a.metadata.bbox)).toEqual(a.metadata.bbox);
    }
  });

  it("drops boxes in any other order or shape", () => {
    // A lat-first box is only detectable when |lng| > 90 (e.g. California);
    // in New England it would pass the range check, which is why the
    // recorded fixtures above pin the order.
    expect(parseBbox([36.5, -120.1, 36.6, -120.0])).toBeNull();
    expect(parseBbox([-71.1, 42.19, -71.18, 42.33])).toBeNull(); // east before west
    expect(parseBbox([-71.18, 42.19, -71.1])).toBeNull();
    expect(parseBbox([-71.18, 42.19, -71.1, "42.33"])).toBeNull();
    expect(parseBbox(null)).toBeNull();
  });
});

describe("RawCoords is opaque", () => {
  it("stringifies to {} and exposes no fields", () => {
    const h = takeAreaCoords(HP_RAW)!;
    expect(h).not.toBeNull();
    expect(JSON.stringify(h)).toBe("{}");
    expect(Object.keys(h)).toEqual([]);
    expect(
      String(JSON.stringify(parseAreaDetail(fixtures.areaHammondPond))),
    ).not.toContain(String(HP_RAW.metadata.lat));
  });

  it("missing or invalid coordinates give null and are not written", async () => {
    expect(takeAreaCoords({ metadata: { lat: 91, lng: 0 } })).toBeNull();
    expect(takeAreaCoords({ metadata: null })).toBeNull();
    const { db } = setup();
    await writeAreaCoords(db.client, [{ id: HAMMOND_POND, coords: null }]);
    expect(db.calls).toEqual([]);
  });
});

describe("cache writes coordinates only through store.ts", () => {
  it("raw coordinates land in the *_coords tables and nowhere else", async () => {
    const { db, opts } = setup();
    expect((await getArea(HAMMOND_POND, opts)).status).toBe("ok");
    expect((await getArea(PAWTUCKAWAY, opts)).status).toBe("ok");

    expect(db.row("area_cache_coords", HAMMOND_POND)).toEqual({
      openbeta_area_id: HAMMOND_POND,
      lat: HP_RAW.metadata.lat,
      lng: HP_RAW.metadata.lng,
      bbox: HP_RAW.metadata.bbox,
    });
    const round = PAW_RAW.children.find((c) => c.uuid === ROUND_POND)!;
    expect(db.row("area_cache_coords", ROUND_POND)).toMatchObject({
      lat: round.metadata.lat,
      lng: round.metadata.lng,
      bbox: null,
    });
    const climb = HP_RAW.children.find((c) => c.uuid === CONTRIVED_FACE)!
      .climbs[0]!;
    expect(db.row("climb_cache_coords", TRANSPLANT)).toEqual({
      openbeta_climb_id: TRANSPLANT,
      lat: climb.metadata.lat,
      lng: climb.metadata.lng,
    });
    // Every child and climb with coordinates got a row.
    expect(db.tables.area_cache_coords).toHaveLength(
      2 + HP_RAW.children.length + PAW_RAW.children.length,
    );
    expect(db.tables.climb_cache_coords).toHaveLength(
      db.tables.climb_cache!.length,
    );

    const publicTables = JSON.stringify([
      db.tables.area_cache,
      db.tables.climb_cache,
    ]);
    for (const a of [
      HP_RAW,
      PAW_RAW,
      ...HP_RAW.children,
      ...PAW_RAW.children,
    ]) {
      expect(publicTables).not.toContain(String(a.metadata.lat));
      expect(publicTables).not.toContain(String(a.metadata.lng));
    }
    // The *_coords upserts are store.ts's: one batch per table per area page.
    const coordWrites = db.calls.filter((c) => c.table.endsWith("_coords"));
    expect(coordWrites.every((c) => c.op === "upsert")).toBe(true);
  });
});

describe("end to end with the location formatter (#29 contract)", () => {
  it("an unflagged area, child and climb built from the cache resolve to exact", async () => {
    const { db, opts } = setup();
    await getArea(PAWTUCKAWAY, opts);
    await getArea(HAMMOND_POND, opts);
    const loc = { client: db.client };

    expect(await getAreaLocation(PAWTUCKAWAY, loc)).toEqual({
      privacy: "exact",
      lat: PAW_RAW.metadata.lat,
      lng: PAW_RAW.metadata.lng,
      bbox: PAW_RAW.metadata.bbox,
    });
    expect(await getAreaLocation(ROUND_POND, loc)).toMatchObject({
      privacy: "exact",
    });
    expect(await getAreaLocation(HAMMOND_POND, loc)).toMatchObject({
      privacy: "exact",
    });
    expect(await getClimbLocation(TRANSPLANT, loc)).toMatchObject({
      privacy: "exact",
    });
  });

  it("a flagged ancestor hides the area, its children and their climbs", async () => {
    const { db, opts } = setup();
    await getArea(PAWTUCKAWAY, opts);
    db.tables.area_privacy = [
      { openbeta_area_id: NH, location_privacy: "hidden", reason: "LCO" },
    ];
    const loc = { client: db.client };
    expect(await getAreaLocation(PAWTUCKAWAY, loc)).toEqual({
      privacy: "hidden",
    });
    expect(await getAreaLocation(ROUND_POND, loc)).toEqual({
      privacy: "hidden",
    });
    const climbId = db.tables.climb_cache!.find(
      (c) => c.openbeta_area_id === ROUND_POND,
    )!.openbeta_climb_id as string;
    expect(await getClimbLocation(climbId, loc)).toEqual({ privacy: "hidden" });
  });

  it("a re-parented area is hidden after the refresh that moves it", async () => {
    const MOVED = "0f0f0f0f-0000-4000-8000-000000000001";
    const moved = structuredClone(fixtures.areaHammondPond) as {
      data: { area: Record<string, unknown> };
    };
    const anc = moved.data.area.ancestors as string[];
    moved.data.area.ancestors = [anc[0], MOVED, HAMMOND_POND];
    moved.data.area.pathTokens = ["USA", "Elsewhere", "Hammond Pond"];
    const { db, opts } = setup();
    await getArea(HAMMOND_POND, opts);
    expect(
      await getAreaLocation(HAMMOND_POND, { client: db.client }),
    ).toMatchObject({ privacy: "exact" });
    await refreshArea(HAMMOND_POND, {
      ...opts,
      fetch: fakeOpenBeta({ [HAMMOND_POND]: moved }).fetch,
    });
    expect(await getAreaLocation(HAMMOND_POND, { client: db.client })).toEqual({
      privacy: "hidden",
    });
    expect(await getClimbLocation(TRANSPLANT, { client: db.client })).toEqual({
      privacy: "hidden",
    });
  });
});

describe("queries", () => {
  it("no exported query proxies a proximity search", () => {
    for (const q of Object.values(queries).flat()) {
      expect(q).not.toMatch(/cragsNear|cragsWithin/);
    }
  });
});
