import { isDevHarnessEnabled } from "./devHarness";

describe("isDevHarnessEnabled", () => {
  it("is enabled in development and test", () => {
    expect(isDevHarnessEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(isDevHarnessEnabled({ NODE_ENV: "test" })).toBe(true);
  });

  it("is enabled on Vercel preview deployments", () => {
    expect(
      isDevHarnessEnabled({ NODE_ENV: "production", VERCEL_ENV: "preview" }),
    ).toBe(true);
  });

  it("is disabled on Vercel production", () => {
    expect(
      isDevHarnessEnabled({ NODE_ENV: "production", VERCEL_ENV: "production" }),
    ).toBe(false);
  });

  it("is disabled for a self-hosted production build", () => {
    expect(isDevHarnessEnabled({ NODE_ENV: "production" })).toBe(false);
  });

  it("is disabled for unknown VERCEL_ENV values in production", () => {
    expect(
      isDevHarnessEnabled({ NODE_ENV: "production", VERCEL_ENV: "staging" }),
    ).toBe(false);
  });
});
