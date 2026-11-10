import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lint-style guard: the service-role key bypasses RLS and must never reach a
 * browser bundle. Any file under src/ that is a client module ("use client")
 * or lives in src/components must not reference it, and nothing may ever
 * declare a NEXT_PUBLIC_ variant of it.
 */

const SRC = join(__dirname, "..", "..");
const SERVICE_ROLE_REFS = [/SUPABASE_SERVICE_ROLE_KEY/, /getServiceRoleKey/];
const CLIENT_DIRECTIVE = /^\s*["']use client["']/m;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\./.test(name))
      out.push(full);
  }
  return out;
}

const files = walk(SRC).map((path) => ({
  path,
  rel: path.slice(SRC.length + 1),
  text: readFileSync(path, "utf8"),
}));

describe("service-role key never reaches client code", () => {
  it("scans at least the supabase helpers", () => {
    expect(files.some((f) => f.rel === "lib/supabase/env.ts")).toBe(true);
  });

  it("no 'use client' module or src/components file references it", () => {
    const offenders = files
      .filter(
        (f) => CLIENT_DIRECTIVE.test(f.text) || f.rel.startsWith("components/"),
      )
      .filter((f) => SERVICE_ROLE_REFS.some((re) => re.test(f.text)))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("nothing declares a NEXT_PUBLIC_ service-role variable", () => {
    const offenders = files
      .filter((f) => /NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
