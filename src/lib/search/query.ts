/**
 * Pure parsing for /search (#31): the free-text query and the V-grade range.
 * Everything here is input sanitizing; the loader in ./search.ts runs it.
 */

/** V-scale bounds offered by the filter. */
export const MIN_V = 0;
export const MAX_V = 17;
const MAX_TERMS = 8;
const MAX_QUERY = 100;

export interface SearchParams {
  /** Trimmed, length-capped text as typed (echoed back into the form). */
  q: string;
  /** Inclusive V-grade range; null = no bound. */
  minV: number | null;
  maxV: number | null;
}

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) ?? "";

function parseV(value: string): number | null {
  const m = /^v?(\d{1,2})$/i.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= MIN_V && n <= MAX_V ? n : null;
}

export function parseSearchParams(raw: Raw): SearchParams {
  let minV = parseV(first(raw.min));
  let maxV = parseV(first(raw.max));
  if (minV !== null && maxV !== null && minV > maxV)
    [minV, maxV] = [maxV, minV];
  return {
    q: first(raw.q).trim().replace(/\s+/g, " ").slice(0, MAX_QUERY),
    minV,
    maxV,
  };
}

/** Word tokens (letters/digits only), lowercased, deduped, capped. */
export function terms(q: string): string[] {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words)].slice(0, MAX_TERMS);
}

/**
 * Postgres `to_tsquery` text: every term must match, each as a prefix
 * ("lieb" finds "Lieback"). Terms are letters/digits only, so no tsquery
 * operators from user input survive. Null when there is nothing to search.
 */
export function toTsQuery(q: string): string | null {
  const t = terms(q);
  return t.length ? t.map((w) => `${w}:*`).join(" & ") : null;
}

/** The proposed_grade values inside the range, e.g. V2..V4 → ["V2","V3","V4"]. */
export function gradesInRange(
  minV: number | null,
  maxV: number | null,
): string[] | null {
  if (minV === null && maxV === null) return null;
  const lo = minV ?? MIN_V;
  const hi = maxV ?? MAX_V;
  return Array.from({ length: hi - lo + 1 }, (_, i) => `V${lo + i}`);
}
