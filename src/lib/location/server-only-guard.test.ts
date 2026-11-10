import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The location module reads raw coordinates with the service role, so it must
 * never reach a browser bundle. Two layers:
 * 1. Its entry points `import "server-only"`, so `next build` fails if any
 *    client module pulls them in, even transitively.
 * 2. This test fails CI if a "use client" module or a src/components file
 *    imports anything under src/lib/location directly.
 */

const SRC = join(__dirname, "..", "..");
const CLIENT_DIRECTIVE = /^\s*["']use client["']/m;
const IMPORT_SPEC =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;

const toPosix = (p: string) => p.split(sep).join("/");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\./.test(name))
      out.push(full);
  }
  return out;
}

/** True when `text` (a file at `path`) imports the location module. */
function importsLocation(path: string, text: string): boolean {
  for (const [, spec = ""] of text.matchAll(IMPORT_SPEC)) {
    let target: string;
    if (spec.startsWith("@/")) target = join(SRC, spec.slice(2));
    else if (spec.startsWith(".")) target = resolve(dirname(path), spec);
    else continue;
    const rel = toPosix(relative(SRC, target)).replace(/\.(ts|tsx|js)$/, "");
    if (rel === "lib/location" || rel.startsWith("lib/location/")) return true;
  }
  return false;
}

const files = walk(SRC).map((path) => ({
  path,
  rel: toPosix(relative(SRC, path)),
  text: readFileSync(path, "utf8"),
}));

describe("location module never reaches client code", () => {
  it("entry points that read coords or the secret import server-only first", () => {
    for (const rel of ["lib/location.ts", "lib/location/fuzz.ts"]) {
      const file = files.find((f) => f.rel === rel);
      expect(file, rel).toBeDefined();
      expect(file!.text).toMatch(/^import "server-only";$/m);
    }
  });

  it("the detector catches the import styles a client file might use", () => {
    const client = join(SRC, "components", "Map.tsx");
    for (const line of [
      'import { getAreaLocation } from "@/lib/location";',
      'import { fuzzPoint } from "@/lib/location/fuzz";',
      'import { getAreaLocation } from "../lib/location";',
      'const m = await import("../lib/location.ts");',
    ]) {
      expect(importsLocation(client, `"use client";\n${line}`), line).toBe(
        true,
      );
    }
    expect(
      importsLocation(client, 'import { x } from "@/lib/locations";'),
    ).toBe(false);
  });

  it("no 'use client' module or src/components file imports it", () => {
    const offenders = files
      .filter(
        (f) => CLIENT_DIRECTIVE.test(f.text) || f.rel.startsWith("components/"),
      )
      .filter((f) => importsLocation(f.path, f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
