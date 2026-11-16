import { expect, test } from "@playwright/test";

// @smoke specs need no secrets and write nothing, so they are safe against a
// deployed URL.

test("@smoke landing page renders the pitch and primary links", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "SandBag" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Browse boulders" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Upload a scan" })).toBeVisible();
});

test("@smoke health endpoint is up", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.ok).toBe(true);
  // A deployed site with no Supabase env vars still serves pages; catch that.
  if (process.env.BASE_URL) expect(body.supabase).toBe("configured");
});

test("@smoke signed-out users are sent to sign-in from gated pages", async ({
  page,
}) => {
  await page.goto("/upload");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("@smoke no horizontal scroll on the landing page", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("@smoke landing hero shows the 3D canvas, or the poster without WebGL", async ({
  page,
}) => {
  await page.goto("/");
  const hero = page.locator('[data-slot="hero-visual"]');
  await expect(hero).toBeVisible();
  const box = await hero.boundingBox();
  expect(box?.height).toBeGreaterThan(100);
  const webgl = await page.evaluate(
    () => !!document.createElement("canvas").getContext("webgl2"),
  );
  if (webgl) {
    await expect(hero.locator("canvas")).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(hero).toHaveAttribute("data-hero-state", "poster");
    await expect(hero.locator("img")).toBeVisible();
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("@smoke areas index loads", async ({ page }) => {
  const res = await page.goto("/areas");
  expect(res?.status()).toBeLessThan(500);
  await expect(
    page.getByRole("heading", { level: 1, name: "Areas" }),
  ).toBeVisible();
});

// Each route must fit a phone: no horizontal scroll at 360 and 390 px.
for (const width of [360, 390]) {
  test(`@smoke browse routes have no horizontal scroll at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ["/areas", "/search", "/search?q=zzz", "/nope-404"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow, `${path} overflows at ${width}px`).toBe(false);
    }
  });
}

test("@smoke areas empty state invites a contribution", async ({ page }) => {
  // Skips on a seeded database, where the index is not empty.
  await page.goto("/areas");
  const empty = page.getByRole("heading", { name: "No boulders yet" });
  test.skip(!(await empty.isVisible()), "database has published boulders");
  await expect(
    page.getByRole("link", { name: "Contribute a scan" }),
  ).toHaveAttribute("href", "/upload");
});

test("@smoke search shows guidance before a query", async ({ page }) => {
  await page.goto("/search");
  await expect(
    page.getByRole("heading", { name: "Find a boulder" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Browse by area" }),
  ).toHaveAttribute("href", "/areas");
});

test("@smoke unknown routes show a friendly not-found with a way back", async ({
  page,
}) => {
  const res = await page.goto("/definitely-not-a-page");
  expect(res?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: /could not find/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse areas" })).toBeVisible();
});

test("@smoke the FAQ answers questions in four sections", async ({ page }) => {
  await page.goto("/faq");
  await expect(
    page.getByRole("heading", { level: 1, name: /frequently asked/i }),
  ).toBeVisible();
  for (const name of [
    "Scanning and uploading",
    "Review and publishing",
    "Access and privacy",
    "Licensing and data",
  ]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  // A native disclosure opens on click and shows its answer.
  const q = page.getByText("How big can a file be?");
  await q.click();
  await expect(page.getByText(/caps every file at 50 MB/)).toBeVisible();
});

test("@smoke Home and FAQ are reachable from the header on every screen size", async ({
  page,
  isMobile,
}) => {
  await page.goto("/faq");
  // On phones the links live behind the Menu disclosure.
  if (isMobile) await page.getByText("Menu", { exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav
    .getByRole("link", { name: "Home" })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "SandBag" }),
  ).toBeVisible();
});
