import { expect, test } from "@playwright/test";
import { hasDb } from "./support/env";

test.skip(!hasDb, "needs supabase start + pnpm seed (see docs/e2e.md)");

// The demo scan `pnpm seed` publishes (src/lib/fixtures/demo-boulder.json).
const DEMO_SCAN_ID = "00000000-0000-4000-8000-00000000a001";

test("seeded boulder page renders a WebGL canvas", async ({ page }) => {
  // The first visit makes `next dev` compile the whole 3D stack, which can take
  // a minute on a slow disk. Leave room for that and for the diagnostic below.
  test.setTimeout(150_000);

  const browserErrors: string[] = [];
  page.on("pageerror", (e) => browserErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") browserErrors.push(m.text());
  });

  await page.goto(`/boulder/${DEMO_SCAN_ID}`, { timeout: 120_000 });
  try {
    await expect(page.locator("canvas").first()).toBeVisible({
      timeout: 60_000,
    });
  } catch (e) {
    // Say what the page showed (e.g. the viewer's error panel) rather than time out blind.
    const text = (await page.locator("body").innerText({ timeout: 5_000 }))
      .slice(0, 600)
      .replace(/\s+/g, " ");
    throw new Error(
      `no canvas on ${page.url()}. Page said: ${text}. Browser errors: ${browserErrors.slice(0, 5).join(" | ")}`,
      { cause: e },
    );
  }
  const gl = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return !!(c && (c.getContext("webgl2") || c.getContext("webgl")));
  });
  expect(gl).toBe(true);
});
