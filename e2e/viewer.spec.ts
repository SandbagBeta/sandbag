import { expect, test } from "@playwright/test";
import { hasDb } from "./support/env";

test.skip(!hasDb, "needs supabase start + pnpm seed (see docs/e2e.md)");

test("seeded boulder page renders a WebGL canvas and its climbs", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Browse boulders" }).click();
  // Open the first boulder linked from the featured list or the areas index.
  const link = page.locator('a[href^="/boulder/"]').first();
  await expect(link).toBeVisible();
  await link.click();
  const canvas = page.locator("canvas").first();
  try {
    await expect(canvas).toBeVisible({ timeout: 30_000 });
  } catch (e) {
    // Say what the page showed (e.g. the viewer's error panel) instead of a bare timeout.
    const text = (await page.locator("main").innerText()).slice(0, 600);
    throw new Error(`no canvas on ${page.url()}. Page said: ${text}`, {
      cause: e,
    });
  }
  const gl = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return !!(c && (c.getContext("webgl2") || c.getContext("webgl")));
  });
  expect(gl).toBe(true);
});
