/**
 * Effective-privacy decision (ADR 001, rules P1-P4). Pure: it only looks at
 * rows that were already fetched, so every branch is unit-testable. Data
 * access lives in src/lib/location.ts.
 */
import type { LocationPrivacy } from "../types";

/** The area_cache columns the decision needs. Values are `unknown` on purpose: rows are validated here. */
export interface AreaChainRow {
  openbeta_area_id: string;
  ancestors?: unknown;
  path_tokens?: unknown;
  ancestors_changed_at?: unknown;
}

export interface PrivacyRow {
  openbeta_area_id: string;
  location_privacy: unknown;
}

export interface PrivacyChain {
  areaId: string;
  /** The area's own cache row; null when uncached. */
  area: AreaChainRow | null;
  /** Cache rows found for the area's ancestors. */
  ancestorRows: AreaChainRow[];
  /** area_privacy rows found for the area and its ancestors. */
  privacyRows: PrivacyRow[];
}

/** Why an area resolved to hidden. Server-side diagnostics only; never sent to clients. */
export type HiddenCause =
  | "lookup_error"
  | "uncached"
  | "bad_ancestors"
  | "ancestor_uncached"
  | "reparented"
  | "flagged";

export type PrivacyDecision =
  | { privacy: "exact" }
  /** `anchorId`: the root-most fuzzed area in the chain; its fuzzed point stands in for every descendant. */
  | { privacy: "fuzzed_1km"; anchorId: string }
  | { privacy: "hidden"; cause: HiddenCause };

const RANK: Record<LocationPrivacy, number> = {
  exact: 0,
  fuzzed_1km: 1,
  hidden: 2,
};

/** Rank of a stored value; anything unrecognised ranks as hidden (fail closed). */
function rank(value: unknown): number {
  return typeof value === "string" && Object.hasOwn(RANK, value)
    ? RANK[value as LocationPrivacy]
    : RANK.hidden;
}

const hidden = (cause: HiddenCause): PrivacyDecision => ({
  privacy: "hidden",
  cause,
});

export function resolveEffectivePrivacy(chain: PrivacyChain): PrivacyDecision {
  const { areaId, area } = chain;
  // P1: unknown or uncached area.
  if (!area || area.openbeta_area_id !== areaId) return hidden("uncached");

  // P1: missing or malformed ancestors. path_tokens include the area itself,
  // so a consistent row has exactly one more token than ancestors.
  const { ancestors, path_tokens } = area;
  if (
    !Array.isArray(ancestors) ||
    !ancestors.every((id) => typeof id === "string" && id.length > 0) ||
    !Array.isArray(path_tokens) ||
    path_tokens.length !== ancestors.length + 1
  ) {
    return hidden("bad_ancestors");
  }

  // P1: every ancestor must itself be cached.
  const cached = new Map(
    chain.ancestorRows.map((r) => [r.openbeta_area_id, r]),
  );
  const ancestorRows: AreaChainRow[] = [];
  for (const id of ancestors as string[]) {
    const row = cached.get(id);
    if (!row) return hidden("ancestor_uncached");
    ancestorRows.push(row);
  }

  // P3: re-parented area or ancestor, until a reviewer clears it.
  if ([area, ...ancestorRows].some((r) => r.ancestors_changed_at != null)) {
    return hidden("reparented");
  }

  // P4: most restrictive wins across the chain (root-first, then self).
  const chainIds = [...(ancestors as string[]), areaId];
  const byId = new Map<string, unknown[]>();
  for (const row of chain.privacyRows) {
    const list = byId.get(row.openbeta_area_id) ?? [];
    list.push(row.location_privacy);
    byId.set(row.openbeta_area_id, list);
  }
  let worst = RANK.exact;
  let anchorId: string | null = null;
  for (const id of chainIds) {
    for (const value of byId.get(id) ?? []) {
      const r = rank(value);
      if (r === RANK.fuzzed_1km && anchorId === null) anchorId = id;
      worst = Math.max(worst, r);
    }
  }

  if (worst >= RANK.hidden) return hidden("flagged");
  if (worst === RANK.fuzzed_1km && anchorId) {
    return { privacy: "fuzzed_1km", anchorId };
  }
  // P2: exact only after a fully successful lookup with no flag in the chain.
  return { privacy: "exact" };
}
