import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * TEST ONLY. In-memory stand-in for the supabase-js calls the OpenBeta cache
 * and the location formatter make: select/insert/upsert/update with
 * eq/in/ilike/limit/maybeSingle. Enforces primary keys and the cache's
 * foreign keys, so write order bugs fail like they would in Postgres.
 */
type Row = Record<string, unknown>;

const PK: Record<string, string> = {
  area_cache: "openbeta_area_id",
  area_cache_coords: "openbeta_area_id",
  climb_cache: "openbeta_climb_id",
  climb_cache_coords: "openbeta_climb_id",
  area_privacy: "openbeta_area_id",
};
// child table -> [column, parent table]
const FK: Record<string, [string, string]> = {
  area_cache_coords: ["openbeta_area_id", "area_cache"],
  climb_cache: ["openbeta_area_id", "area_cache"],
  climb_cache_coords: ["openbeta_climb_id", "climb_cache"],
};

export interface FakeDbCall {
  table: string;
  op: "select" | "upsert" | "update" | "insert";
  rows?: Row[];
  options?: Record<string, unknown>;
}

export function createFakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = structuredClone(seed);
  const calls: FakeDbCall[] = [];
  const failing = new Set<string>();

  function from(table: string) {
    const rows = (tables[table] ??= []);
    const pk = PK[table] ?? "id";
    const filters: ((r: Row) => boolean)[] = [];
    let limit = Infinity;
    let write: (() => void) | null = null;
    let call: FakeDbCall = { table, op: "select" };

    const fkError = (r: Row) => {
      const fk = FK[table];
      if (!fk) return false;
      return !(tables[fk[1]] ?? []).some((p) => p[PK[fk[1]]!] === r[fk[0]]);
    };
    const run = () => {
      calls.push(call);
      if (failing.has(table)) {
        return { data: null, error: { code: "XX000", message: "boom" } };
      }
      if (write) {
        try {
          write();
        } catch (e) {
          return { data: null, error: e as { code: string } };
        }
        return { data: null, error: null };
      }
      const data = rows
        .filter((r) => filters.every((f) => f(r)))
        .slice(0, limit)
        .map((r) => structuredClone(r));
      return { data, error: null };
    };

    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, vs: unknown[]) => (
        filters.push((r) => vs.includes(r[c])),
        q
      ),
      ilike: (c: string, pattern: string) => {
        const body = pattern
          .replace(/^%|%$/g, "")
          .replace(/\\([\\%_])/g, "$1")
          .toLowerCase();
        filters.push((r) => String(r[c]).toLowerCase().includes(body));
        return q;
      },
      limit: (n: number) => ((limit = n), q),
      maybeSingle: async () => {
        const res = run();
        return res.error
          ? res
          : { data: (res.data as Row[])[0] ?? null, error: null };
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(ok, ko),
      upsert: (input: Row | Row[], options: Record<string, unknown> = {}) => {
        const list = Array.isArray(input) ? input : [input];
        call = { table, op: "upsert", rows: structuredClone(list), options };
        write = () => {
          for (const r of list) {
            if (fkError(r)) throw { code: "23503", message: "fk" };
            const i = rows.findIndex((x) => x[pk] === r[pk]);
            if (i === -1) rows.push(structuredClone(r));
            else if (!options.ignoreDuplicates)
              rows[i] = { ...rows[i], ...structuredClone(r) };
          }
        };
        return q;
      },
      insert: (input: Row | Row[]) => {
        const list = Array.isArray(input) ? input : [input];
        call = { table, op: "insert", rows: structuredClone(list) };
        write = () => {
          for (const r of list) {
            if (rows.some((x) => x[pk] === r[pk])) {
              throw { code: "23505", message: "duplicate" };
            }
            if (fkError(r)) throw { code: "23503", message: "fk" };
            rows.push(structuredClone(r));
          }
        };
        return q;
      },
      update: (patch: Row) => {
        call = { table, op: "update", rows: [structuredClone(patch)] };
        write = () => {
          for (const r of rows) {
            if (filters.every((f) => f(r))) Object.assign(r, patch);
          }
        };
        return q;
      },
    };
    return q;
  }

  return {
    client: { from } as unknown as SupabaseClient,
    tables,
    calls,
    /** Make every call on `table` return an error until `heal`. */
    fail: (table: string) => failing.add(table),
    heal: (table: string) => failing.delete(table),
    row: (table: string, id: string) =>
      (tables[table] ?? []).find((r) => r[PK[table] ?? "id"] === id),
  };
}
