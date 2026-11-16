import { expect, test } from "@playwright/test";
import { signInAs } from "./support/auth";
import { hasDb } from "./support/env";

test.skip(!hasDb, "needs supabase start + pnpm seed (see docs/e2e.md)");

test("a signed-in user reaches /account and /upload", async ({
  page,
  context,
  baseURL,
}) => {
  const email = `e2e-${Date.now()}@example.test`;
  const { userId, admin } = await signInAs(context, baseURL!, email);
  try {
    await page.goto("/account");
    await expect(page).toHaveURL(/\/account/);
    await page.goto("/upload");
    await expect(page).toHaveURL(/\/upload/);
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
});
