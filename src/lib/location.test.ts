import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flagAreaSensitive,
  getAreaLocation,
  getClimbLocation,
  getEffectivePrivacy,
  type LocationOutput,
} from "./location";
import { distanceMeters, fuzzPoint } from "./location/fuzz";

vi.mock("server-only", () => ({}));

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const US = id(1);
const NH = id(2);
const PAW = id(3);
const BOULDER = id(4);
const OTHER = id(5);
const CLIMB = id(6);
const UNCACHED = id(7);
const PROFILE = id(100);
const SECRET = "test-secret-0123456789abcdef0123456789";
const ENV = { LOCATION_FUZZ_SECRET: SECRET };

// Distinctive raw coordinates, so a leak is easy to grep for.
const RAW_BY_ID = new Map([
  [US, { lat: 39.8283, lng: -98.5795 }],
  [NH, { lat: 43.1939, lng: -71.5724 }],
  [PAW, { lat: 43.0812, lng: -71.1704 }],
  [BOULDER, { lat: 43.0833, lng: -71.1777 }],
  [OTHER, { lat: 44.2601, lng: -71.3062 }],
]);
const RAW = (aid: string) => RAW_BY_ID.get(aid)!;
const CLIMB_RAW = { lat: 43.08341, lng: -71.17782 };
const RAW_DIGITS = [...[...RAW_BY_ID.values()], CLIMB_RAW].flatMap((p) => [
  String(p.lat),
  String(p.lng),
]);

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Seeded = Record<
  | "area_cache"
  | "area_cache_coords"
  | "climb_cache"
  | "climb_cache_coords"
  | "area_privacy",
  Row[]
>;

function seed(): Seeded {
  const area = (aid: string, ancestors: string[], path: string[]) => ({
    openbeta_area_id: aid,
    ancestors,
    path_tokens: path,
    ancestors_changed_at: null,
  });
  return {
    area_cache: [
      area(US, [], ["USA"]),
      area(NH, [US], ["USA", "NH"]),
      area(PAW, [US, NH], ["USA", "NH", "Pawtuckaway"]),
      area(BOULDER, [US, NH, PAW], ["USA", "NH", "Pawtuckaway", "Boulder"]),
      area(OTHER, [US, NH], ["USA", "NH", "Other"]),
    ],
    area_cache_coords: [...RAW_BY_ID.entries()].map(([aid, p]) => ({
      openbeta_area_id: aid,
      ...p,
      bbox: [p.lng - 0.01, p.lat - 0.01, p.lng + 0.01, p.lat + 0.01],
    })),
    climb_cache: [{ openbeta_climb_id: CLIMB, openbeta_area_id: BOULDER }],
    climb_cache_coords: [{ openbeta_climb_id: CLIMB, ...CLIMB_RAW }],
    area_privacy: [],
  };
}

/** Minimal in-memory stand-in for the supabase-js query builder. */
function fakeDb(tables: Tables, failing: string[] = []) {
  const queried: string[] = [];
  const error = {
    code: "XX000",
    message: `boom near ${RAW(PAW).lat},${RAW(PAW).lng}`,
    details: JSON.stringify(RAW(PAW)),
  };
  const from = (table: string) => {
    queried.push(table);
    const filters: ((r: Row) => boolean)[] = [];
    const run = () =>
      failing.includes(table)
        ? { data: null, error }
        : {
            data: (tables[table] ?? []).filter((r) =>
              filters.every((f) => f(r)),
            ),
            error: null,
          };
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, vs: unknown[]) => (
        filters.push((r) => vs.includes(r[c])),
        q
      ),
      maybeSingle: async () => {
        const res = run();
        return res.error ? res : { data: res.data![0] ?? null, error: null };
      },
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(ok, ko),
      insert: async (row: Row) => {
        if (failing.includes(table)) return { error };
        const rows = (tables[table] ??= []);
        if (rows.some((r) => r.openbeta_area_id === row.openbeta_area_id)) {
          return { error: { code: "23505", message: "duplicate key" } };
        }
        rows.push(row);
        return { error: null };
      },
    };
    return q;
  };
  return { client: { from } as unknown as SupabaseClient, queried };
}

const flag = (t: Seeded, aid: string, v: string) =>
  t.area_privacy.push({
    openbeta_area_id: aid,
    location_privacy: v,
    reason: "LCO",
  });

let logs: unknown[][];
beforeEach(() => {
  logs = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, m).mockImplementation((...args) => void logs.push(args));
  }
});
afterEach(() => vi.restoreAllMocks());

function expectNoCoordsLogged() {
  const text = JSON.stringify(logs);
  for (const d of RAW_DIGITS) expect(text).not.toContain(d);
}

function expectHiddenShape(out: LocationOutput) {
  expect(out).toEqual({ privacy: "hidden" });
  expect(Object.keys(out)).toEqual(["privacy"]);
  expect(JSON.stringify(out)).toBe('{"privacy":"hidden"}');
  for (const d of RAW_DIGITS) expect(JSON.stringify(out)).not.toContain(d);
}

describe("getAreaLocation", () => {
  it("returns exact coordinates and bbox when nothing is flagged", async () => {
    const { client } = fakeDb(seed());
    const out = await getAreaLocation(PAW, { client, env: ENV });
    expect(out).toEqual({
      privacy: "exact",
      ...RAW(PAW),
      bbox: [
        RAW(PAW).lng - 0.01,
        RAW(PAW).lat - 0.01,
        RAW(PAW).lng + 0.01,
        RAW(PAW).lat + 0.01,
      ],
    });
  });

  it("a hidden ancestor hides every descendant and never reads coordinates", async () => {
    const t = seed();
    flag(t, NH, "hidden");
    const db = fakeDb(t);
    for (const aid of [NH, PAW, BOULDER, OTHER]) {
      expectHiddenShape(
        await getAreaLocation(aid, { client: db.client, env: ENV }),
      );
    }
    expectHiddenShape(
      await getClimbLocation(CLIMB, { client: db.client, env: ENV }),
    );
    expect(db.queried.filter((q) => q.endsWith("_coords"))).toEqual([]);
    expect((await getAreaLocation(US, { client: db.client })).privacy).toBe(
      "exact",
    );
  });

  it.each(["area_cache", "area_privacy", "area_cache_coords"])(
    "a DB error on %s is hidden and logs no coordinates",
    async (table) => {
      const { client } = fakeDb(seed(), [table]);
      expectHiddenShape(await getAreaLocation(PAW, { client, env: ENV }));
      expect(logs.length).toBeGreaterThan(0);
      expectNoCoordsLogged();
    },
  );

  it("a thrown client error is hidden", async () => {
    const client = {
      from: () => {
        throw new Error(`socket closed at ${RAW(PAW).lat}`);
      },
    } as unknown as SupabaseClient;
    expectHiddenShape(await getAreaLocation(PAW, { client }));
    expectNoCoordsLogged();
  });

  it("is hidden, not a crash, when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expectHiddenShape(await getAreaLocation(PAW));
    vi.unstubAllEnvs();
  });

  it("an uncached or malformed id is hidden", async () => {
    const db = fakeDb(seed());
    expectHiddenShape(await getAreaLocation(UNCACHED, { client: db.client }));
    expectHiddenShape(
      await getAreaLocation("not-a-uuid", { client: db.client }),
    );
  });

  it("missing ancestors are hidden", async () => {
    const t = seed();
    t.area_cache.find((r) => r.openbeta_area_id === PAW)!.ancestors = null;
    const { client } = fakeDb(t);
    expectHiddenShape(await getAreaLocation(PAW, { client }));
  });

  it("an ancestor missing from the cache is hidden", async () => {
    const t = seed();
    t.area_cache = t.area_cache.filter((r) => r.openbeta_area_id !== NH);
    const { client } = fakeDb(t);
    expectHiddenShape(await getAreaLocation(BOULDER, { client }));
  });

  it.each([PAW, NH, US])(
    "re-parenting (ancestors_changed_at on %s) hides the boulder",
    async (aid) => {
      const t = seed();
      t.area_cache.find(
        (r) => r.openbeta_area_id === aid,
      )!.ancestors_changed_at = "2026-11-10T00:00:00Z";
      const { client } = fakeDb(t);
      expectHiddenShape(await getAreaLocation(BOULDER, { client }));
      expectHiddenShape(await getClimbLocation(CLIMB, { client }));
    },
  );

  it("most restrictive wins: an exact row cannot undo a hidden ancestor", async () => {
    const t = seed();
    flag(t, PAW, "hidden");
    flag(t, BOULDER, "exact");
    const { client } = fakeDb(t);
    expectHiddenShape(await getAreaLocation(BOULDER, { client }));
    expect(await getEffectivePrivacy(BOULDER, { client })).toBe("hidden");
  });

  it("is unavailable (no coordinate keys) when no coordinates are cached", async () => {
    const t = seed();
    t.area_cache_coords = [];
    const { client } = fakeDb(t);
    expect(await getAreaLocation(PAW, { client })).toEqual({
      privacy: "unavailable",
    });
  });
});

describe("fuzzed_1km", () => {
  const fuzzedSeed = () => {
    const t = seed();
    flag(t, PAW, "fuzzed_1km");
    flag(t, OTHER, "fuzzed_1km");
    return t;
  };

  it("is stable, within 1 km, never raw, and has no bbox", async () => {
    const { client } = fakeDb(fuzzedSeed());
    const a = await getAreaLocation(PAW, { client, env: ENV });
    expect(a.privacy).toBe("fuzzed_1km");
    expect(Object.keys(a).sort()).toEqual(["lat", "lng", "privacy"]);
    expect(await getAreaLocation(PAW, { client, env: ENV })).toEqual(a);
    if (a.privacy !== "fuzzed_1km") return;
    expect(a).toMatchObject(fuzzPoint(RAW(PAW), PAW, SECRET));
    const d = distanceMeters(RAW(PAW), a);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(1000);
  });

  it("differs between areas", async () => {
    const { client } = fakeDb(fuzzedSeed());
    const a = await getAreaLocation(PAW, { client, env: ENV });
    const b = await getAreaLocation(OTHER, { client, env: ENV });
    expect(a).not.toEqual(b);
  });

  it("children and climbs share the fuzzed ancestor's point, never their own raw coords", async () => {
    const { client } = fakeDb(fuzzedSeed());
    const anchor = await getAreaLocation(PAW, { client, env: ENV });
    const child = await getAreaLocation(BOULDER, { client, env: ENV });
    const climb = await getClimbLocation(CLIMB, { client, env: ENV });
    expect(child).toEqual(anchor);
    expect(climb).toEqual(anchor);
    const text = JSON.stringify([child, climb]);
    for (const p of [RAW(BOULDER), CLIMB_RAW]) {
      expect(text).not.toContain(String(p.lat));
      expect(text).not.toContain(String(p.lng));
    }
  });

  it("fails closed to hidden, with a coordinate-free warning, without a secret", async () => {
    const { client } = fakeDb(fuzzedSeed());
    for (const env of [{}, { LOCATION_FUZZ_SECRET: "short" }]) {
      expectHiddenShape(await getAreaLocation(BOULDER, { client, env }));
      expectHiddenShape(await getClimbLocation(CLIMB, { client, env }));
    }
    expect(JSON.stringify(logs)).toContain("LOCATION_FUZZ_SECRET");
    expectNoCoordsLogged();
  });
});

describe("getClimbLocation", () => {
  it("returns the climb's own exact coordinates", async () => {
    const { client } = fakeDb(seed());
    expect(await getClimbLocation(CLIMB, { client })).toEqual({
      privacy: "exact",
      ...CLIMB_RAW,
      bbox: null,
    });
  });

  it.each(["climb_cache", "climb_cache_coords", "area_privacy"])(
    "a DB error on %s is hidden",
    async (table) => {
      const { client } = fakeDb(seed(), [table]);
      expectHiddenShape(await getClimbLocation(CLIMB, { client }));
      expectNoCoordsLogged();
    },
  );

  it("an uncached climb is hidden", async () => {
    const { client } = fakeDb(seed());
    expectHiddenShape(await getClimbLocation(UNCACHED, { client }));
  });
});

describe("flagAreaSensitive", () => {
  const input = { areaId: PAW, profileId: PROFILE, reason: "nesting raptors" };

  it("inserts a hidden row, which takes effect immediately", async () => {
    const t = seed();
    const { client } = fakeDb(t);
    expect(await flagAreaSensitive(input, { client })).toEqual({
      status: "flagged",
    });
    expect(t.area_privacy).toEqual([
      expect.objectContaining({
        openbeta_area_id: PAW,
        location_privacy: "hidden",
        set_by: PROFILE,
      }),
    ]);
    expectHiddenShape(await getAreaLocation(BOULDER, { client }));
  });

  it.each(["exact", "fuzzed_1km", "hidden"])(
    "never overwrites or downgrades an existing %s row",
    async (value) => {
      const t = seed();
      flag(t, PAW, value);
      const before = structuredClone(t.area_privacy);
      const { client } = fakeDb(t);
      expect(await flagAreaSensitive(input, { client })).toEqual({
        status: "already_set",
      });
      expect(t.area_privacy).toEqual(before);
    },
  );

  it("rejects invalid input and surfaces DB failures", async () => {
    const { client } = fakeDb(seed());
    await expect(
      flagAreaSensitive({ ...input, reason: "  " }, { client }),
    ).rejects.toThrow();
    await expect(
      flagAreaSensitive({ ...input, areaId: "x" }, { client }),
    ).rejects.toThrow();
    const failing = fakeDb(seed(), ["area_privacy"]).client;
    await expect(flagAreaSensitive(input, { client: failing })).rejects.toThrow(
      /XX000/,
    );
  });
});
