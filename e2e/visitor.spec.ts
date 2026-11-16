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

test("@smoke areas index loads", async ({ page }) => {
  const res = await page.goto("/areas");
  expect(res?.status()).toBeLessThan(500);
  await expect(
    page.getByRole("heading", { level: 1, name: "Areas" }),
  ).toBeVisible();
});
