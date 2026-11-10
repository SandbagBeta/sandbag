import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lint-style guard (CLAUDE.md "state machine discipline", #20): only the
 * lifecycle module (src/lib/lifecycle/) may write `status` on scans or climbs.
 *
 * Heuristic, tuned to over-report: a supabase-js chain that starts at
 * `.from("scans"|"climbs")` and reaches `.update(`/`.upsert(`/`.insert(` with
 * the word `status` in it before the next `.from(`, or raw SQL that updates or
 * inserts `status` on those tables. It cannot see dynamic table names; the
 * DB-level backstop is that `authenticated` has no grant on the status column
 * (RLS migration), so only service-role code can write it at all.
 *
 * Got a false positive? Move the write into the lifecycle module rather than
 * loosening this test.
 */

const ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["src", "scripts", join("supabase", "functions")];
const ALLOWED_PREFIX = "src/lib/lifecycle/";

const JS_FROM = /\.from\(\s*["'`](?:public\.)?(scans|climbs)["'`]\s*\)/g;
const JS_WRITE = /\.(update|upsert|insert)\s*\(/;
const SQL_WRITES = [
  /\bupdate\s+(?:public\.)?(?:scans|climbs)\b[^;]*?\bset\b[^;]*?\bstatus\b/gi,
  /\binsert\s+into\s+(?:public\.)?(?:scans|climbs)\s*\([^)]*\bstatus\b/gi,
];

/** Returns a short snippet for each suspected status write in `text`. */
function findStatusWrites(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(JS_FROM)) {
    const start = m.index + m[0].length;
    const nextFrom = text.indexOf(".from(", start);
    const chain = text.slice(start, nextFrom === -1 ? start + 800 : nextFrom);
    const write = JS_WRITE.exec(chain);
    if (write && /\bstatus\b/.test(chain.slice(write.index))) {
      hits.push(m[0] + chain.slice(0, 80).replace(/\s+/g, " "));
    }
  }
  for (const re of SQL_WRITES) {
    for (const m of text.matchAll(re)) hits.push(m[0].slice(0, 80));
  }
  return hits;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|sql)$/.test(name)) out.push(full);
  }
  return out;
}

describe("findStatusWrites (guard fixtures)", () => {
  it.each([
    `await db.from("scans").update({ status: "published" }).eq("id", id)`,
    `supabase\n  .from('climbs')\n  .insert({ name, status: 'published' })`,
    "db.from(`scans`).upsert(rows.map((r) => ({ ...r, status })))",
    `update public.scans set qc_report = $1, status = 'published' where id = $2`,
    `INSERT INTO climbs (id, name, status) VALUES ($1, $2, $3)`,
  ])("flags %s", (code) => {
    expect(findStatusWrites(code)).toHaveLength(1);
  });

  it.each([
    `db.from("scans").select("id, status").eq("status", "published")`,
    `db.from("scans").update({ qc_report }).eq("id", id); db.from("climbs").select("status")`,
    `db.from("reviews").insert({ verdict, status: "x" })`,
    `update public.profiles set trust_level = 'reviewer'`,
  ])("does not flag %s", (code) => {
    expect(findStatusWrites(code)).toEqual([]);
  });
});

describe("no ad-hoc status writes outside the lifecycle module", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))).map((path) => ({
    rel: relative(ROOT, path).split(sep).join("/"),
    text: readFileSync(path, "utf8"),
  }));

  it("scans src/ and scripts/", () => {
    expect(files.some((f) => f.rel === "src/lib/lifecycle/apply.ts")).toBe(
      true,
    );
    expect(files.some((f) => f.rel.startsWith("scripts/"))).toBe(true);
  });

  it("the lifecycle module itself is the only writer", () => {
    const offenders = files
      .filter((f) => !f.rel.startsWith(ALLOWED_PREFIX))
      .filter((f) => !/\.test\.[a-z]+$/.test(f.rel))
      .flatMap((f) =>
        findStatusWrites(f.text).map((hit) => `${f.rel}: ${hit}`),
      );
    expect(offenders).toEqual([]);
  });
});
