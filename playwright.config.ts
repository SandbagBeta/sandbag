import { defineConfig, devices } from "@playwright/test";

// One suite, two targets:
//  - local: `pnpm e2e` starts `pnpm dev` (needs `supabase start` + `pnpm seed`
//    for the database-backed specs).
//  - hosted: `BASE_URL=https://<deployment> pnpm e2e:smoke` runs only @smoke
//    specs, which need no secrets and write nothing.
const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const hosted = Boolean(process.env.BASE_URL);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Software WebGL so the 3D viewer renders without a GPU.
        launchOptions: {
          args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--ignore-gpu-blocklist",
          ],
        },
      },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@smoke/ },
  ],
  webServer: hosted
    ? undefined
    : {
        command: "pnpm dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
