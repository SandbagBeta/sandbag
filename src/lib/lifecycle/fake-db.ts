import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * TEST ONLY. A tiny in-memory stand-in for the supabase-js query builder,
 * covering exactly the calls the lifecycle module makes: select/update/
 * insert/delete with `.eq()` filters, `.select()`, `.single()`,
 * `.maybeSingle()`. Every call is logged so tests can assert write order.
 */
type Row = Record<string, unknown>;
type Op = "select" | "update" | "insert" | "delete";

export interface FakeDb {
  client: SupabaseClient;
  tables: Record<string, Row[]>;
  /** Row `i` of `table`; throws if absent (keeps tests strict-index safe). */
  row(table: string, i?: number): Row;
  log: { table: string; op: Op; values?: Row; filters: [string, unknown][] }[];
  /** Make the next matching op return `{ error }` instead of touching data. */
  failNext(table: string, op: Op, message?: string): void;
  /** Run `fn` just before the next matching op executes (simulate a racer). */
  beforeNext(table: string, op: Op, fn: () => void): void;
}

export function createFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const tables: Record<string, Row[]> = structuredClone(seed);
  const log: FakeDb["log"] = [];
  const failures: { table: string; op: Op; message: string }[] = [];
  const hooks: { table: string; op: Op; fn: () => void }[] = [];
  let nextId = 1;

  const take = <T extends { table: string; op: Op }>(
    list: T[],
    table: string,
    op: Op,
  ) => {
    const i = list.findIndex((x) => x.table === table && x.op === op);
    return i === -1 ? undefined : list.splice(i, 1)[0];
  };

  function from(table: string) {
    let op: Op = "select";
    let values: Row | undefined;
    let single: "one" | "maybe" | null = null;
    const filters: [string, unknown][] = [];

    const run = () => {
      take(hooks, table, op)?.fn();
      log.push({ table, op, values, filters: [...filters] });
      const failure = take(failures, table, op);
      if (failure) return { data: null, error: { message: failure.message } };
      const rows = (tables[table] ??= []);
      const match = (r: Row) => filters.every(([k, v]) => r[k] === v);
      let out: Row[];
      if (op === "insert") {
        const row = {
          id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
          created_at: "now",
          ...values,
        };
        rows.push(row);
        out = [row];
      } else if (op === "delete") {
        out = rows.filter(match);
        tables[table] = rows.filter((r) => !match(r));
      } else {
        out = rows.filter(match);
        if (op === "update") for (const r of out) Object.assign(r, values);
      }
      out = out.map((r) => ({ ...r }));
      if (single === "one") {
        return out.length === 1
          ? { data: out[0], error: null }
          : { data: null, error: { message: "not exactly one row" } };
      }
      if (single === "maybe") return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    };

    const builder = {
      select: () => builder,
      update: (v: Row) => ((op = "update"), (values = v), builder),
      insert: (v: Row) => ((op = "insert"), (values = v), builder),
      delete: () => ((op = "delete"), builder),
      eq: (k: string, v: unknown) => (filters.push([k, v]), builder),
      single: () => ((single = "one"), builder),
      maybeSingle: () => ((single = "maybe"), builder),
      then: (
        resolve: (v: ReturnType<typeof run>) => unknown,
        reject: (e: unknown) => unknown,
      ) => Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  }

  return {
    client: { from } as unknown as SupabaseClient,
    tables,
    row: (table, i = 0) => {
      const r = tables[table]?.[i];
      if (!r) throw new Error(`fake db: no row ${i} in ${table}`);
      return r;
    },
    log,
    failNext: (table, op, message = "boom") =>
      void failures.push({ table, op, message }),
    beforeNext: (table, op, fn) => void hooks.push({ table, op, fn }),
  };
}
