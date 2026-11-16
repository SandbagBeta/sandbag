import { expect, test } from "@playwright/test";
import { hasDb } from "./support/env";

test.skip(!hasDb, "needs supabase start + pnpm seed (see docs/e2e.md)");

// Values §2: no code path outputs raw coordinates for a hidden area. This is a
// coarse net over rendered HTML; the formatter's own tests are the real gate.
const COORD_PAIR = /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/;

for (const path of ["/", "/areas", "/search"]) {
  test(`${path} HTML carries no coordinate pairs`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.ok()).toBe(true);
    expect(await page.content()).not.toMatch(COORD_PAIR);
  });
}
