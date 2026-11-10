/**
 * Validate OpenBeta responses into the shapes the cache stores. Malformed
 * input throws `bad_response`. Coordinates are never read here: each raw
 * node goes to store.ts, which returns an opaque handle.
 */
import {
  takeAreaCoords,
  takeClimbCoords,
  type RawCoords,
} from "../location/store";
import { OpenBetaError } from "./transport";

export interface ClimbNode {
  id: string;
  areaId: string;
  name: string;
  grades: Record<string, string>;
  isBoulder: boolean | null;
  coords: RawCoords | null;
}

export interface ChildNode {
  id: string;
  name: string;
  isLeaf: boolean | null;
  totalClimbs: number | null;
  coords: RawCoords | null;
  climbs: ClimbNode[];
}

export interface AreaNode extends Omit<ChildNode, "climbs"> {
  /** OpenBeta's full pathTokens, INCLUDING the area itself. */
  pathTokens: string[];
  /** Root-first ancestor ids, EXCLUDING the area itself (#29 contract). */
  ancestors: string[];
  organizations: Organization[];
  /** authorMetadata.updatedAt as ISO, the change marker. */
  updatedAt: string | null;
  climbs: ClimbNode[];
  children: ChildNode[];
}

export interface Organization {
  orgId: string;
  orgType: string | null;
  displayName: string;
  website: string | null;
}

export interface AreaSearchHit {
  id: string;
  name: string;
  pathTokens: string[];
  totalClimbs: number | null;
  isLeaf: boolean | null;
}

type Raw = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bad = (): never => {
  throw new OpenBetaError("bad_response");
};
const obj = (v: unknown): Raw =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : bad();
const list = (v: unknown): unknown[] =>
  v == null ? [] : Array.isArray(v) ? v : bad();
const uuid = (v: unknown): string =>
  typeof v === "string" && UUID.test(v) ? v.toLowerCase() : bad();
const text = (v: unknown): string =>
  typeof v === "string" && v.trim() ? v : bad();
const optText = (v: unknown) => (typeof v === "string" && v ? v : null);
const optBool = (v: unknown) => (typeof v === "boolean" ? v : null);
const count = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null;
const leaf = (r: Raw) =>
  optBool((r.metadata as Raw | null | undefined)?.leaf ?? null);

function parseClimb(v: unknown, areaId: string): ClimbNode {
  const r = obj(v);
  const grades: Record<string, string> = {};
  for (const [k, g] of Object.entries(obj(r.grades ?? {}))) {
    if (typeof g === "string" && g) grades[k] = g;
  }
  return {
    id: uuid(r.uuid),
    areaId,
    name: text(r.name),
    grades,
    // ADR §3: climb.type.bouldering is reliable, metadata.isBoulder is not.
    isBoulder: optBool((r.type as Raw | null | undefined)?.bouldering ?? null),
    coords: takeClimbCoords(r),
  };
}

function parseChild(v: unknown): ChildNode {
  const r = obj(v);
  const id = uuid(r.uuid);
  return {
    id,
    name: text(r.areaName),
    isLeaf: leaf(r),
    totalClimbs: count(r.totalClimbs),
    coords: takeAreaCoords(r),
    climbs: list(r.climbs).map((c) => parseClimb(c, id)),
  };
}

const epochToIso = (v: unknown) => {
  const ms =
    typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/** `AreaDetail` data → AreaNode, or null when OpenBeta has no such area. */
export function parseAreaDetail(data: unknown): AreaNode | null {
  const raw = obj(data).area;
  if (raw == null) return null;
  const r = obj(raw);
  const base = parseChild(r);
  const pathTokens = list(r.pathTokens).map(text);
  // OpenBeta's ancestors include the area itself as the last element.
  const chain = list(r.ancestors).map(uuid);
  if (
    chain.length === 0 ||
    chain.at(-1) !== base.id ||
    pathTokens.length !== chain.length
  ) {
    bad();
  }
  return {
    ...base,
    pathTokens,
    ancestors: chain.slice(0, -1),
    organizations: list(r.organizations).map((o) => {
      const org = obj(o);
      return {
        orgId: text(org.orgId),
        orgType: optText(org.orgType),
        displayName: text(org.displayName),
        website: optText((org.content as Raw | null | undefined)?.website),
      };
    }),
    updatedAt: epochToIso((r.authorMetadata as Raw | null)?.updatedAt),
    children: list(r.children).map(parseChild),
  };
}

/** `ClimbsInArea` data → the leaf's climbs, or null when the area is unknown. */
export function parseClimbsInArea(data: unknown): ClimbNode[] | null {
  const raw = obj(data).area;
  if (raw == null) return null;
  const r = obj(raw);
  const id = uuid(r.uuid);
  return list(r.climbs).map((c) => parseClimb(c, id));
}

/** `ClimbById` data → ClimbNode (areaId = parent leaf), or null when unknown. */
export function parseClimbById(data: unknown): ClimbNode | null {
  const raw = obj(data).climb;
  if (raw == null) return null;
  const r = obj(raw);
  return parseClimb(r, uuid(obj(r.parent).uuid));
}

export function parseSearch(data: unknown): AreaSearchHit[] {
  return list(obj(data).areas).map((v) => {
    const r = obj(v);
    return {
      id: uuid(r.uuid),
      name: text(r.areaName),
      pathTokens: list(r.pathTokens).map(text),
      totalClimbs: count(r.totalClimbs),
      isLeaf: leaf(r),
    };
  });
}
