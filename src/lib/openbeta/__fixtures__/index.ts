/**
 * TEST ONLY. Live OpenBeta responses recorded 2026-11-10 from
 * https://api.openbeta.io/ with the queries in ../queries.ts (CC0 data,
 * ADR 001 §1). Bodies are byte-for-byte as served; they select no prose,
 * location text or media, so nothing needed stripping.
 */
import areaHammondPond from "./area-hammond-pond.json";
import areaPawtuckaway from "./area-pawtuckaway.json";
import climb from "./climb.json";
import climbsInArea from "./climbs-in-area.json";
import searchHammondPond from "./search-hammond-pond.json";

export const HAMMOND_POND = "6e4aac5e-8949-5ac5-908a-004ac553dd84";
export const PAWTUCKAWAY = "f472e63d-9089-5206-ab16-8385450ac7a4";
export const CONTRIVED_FACE = "abbd962a-1f61-5b3d-bb7f-d01a9dc1da6e"; // leaf under Hammond Pond
export const TRANSPLANT = "b7fd39c8-8044-5605-afa6-86396cd3132f"; // V3, on Contrived Face
export const ROUND_POND = "d92b0aef-7a44-5cae-ae0d-eca1bc4d7b7d"; // leaf under Pawtuckaway

export const fixtures = {
  areaHammondPond,
  areaPawtuckaway,
  climb,
  climbsInArea,
  searchHammondPond,
};

type Body = { data: unknown };
const clone = (b: Body): Body => structuredClone(b);

/**
 * A fetch stand-in that answers from the fixtures by operation name and
 * variables. `areas` maps an area uuid to a body (defaults: the two test
 * areas). Unknown areas answer `{ area: null }`.
 */
export function fakeOpenBeta(areas: Record<string, Body> = {}) {
  const byArea: Record<string, Body> = {
    [HAMMOND_POND]: areaHammondPond,
    [PAWTUCKAWAY]: areaPawtuckaway,
    ...areas,
  };
  const requests: { op: string; variables: Record<string, unknown> }[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init?.body));
    const op = /query (\w+)/.exec(query)?.[1] ?? "?";
    requests.push({ op, variables });
    let body: Body = { data: null };
    if (op === "AreaDetail") {
      const hit = byArea[variables.uuid];
      body = hit ? clone(hit) : { data: { area: null } };
    } else if (op === "ClimbById") {
      body =
        variables.uuid === TRANSPLANT ? clone(climb) : { data: { climb: null } };
    } else if (op === "ClimbsInArea") body = clone(climbsInArea);
    else if (op === "SearchAreas") body = clone(searchHammondPond);
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}
