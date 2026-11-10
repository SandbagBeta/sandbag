import {
  GATED_PATH_PREFIXES,
  gateRedirect,
  isGatedPath,
  signInPath,
} from "./gating";

describe("isGatedPath", () => {
  it("gates /account and its subpaths", () => {
    expect(GATED_PATH_PREFIXES).toContain("/account");
    expect(isGatedPath("/account")).toBe(true);
    expect(isGatedPath("/account/")).toBe(true);
    expect(isGatedPath("/account/settings")).toBe(true);
  });

  it.each([
    "/",
    "/sign-in",
    "/auth/callback",
    "/accounts",
    "/account-help",
    "/dev/viewer",
    "/api/health",
  ])("leaves %j public", (path) => {
    expect(isGatedPath(path)).toBe(false);
  });

  it("gates /upload and its subpaths (#15), not look-alikes", () => {
    expect(GATED_PATH_PREFIXES).toContain("/upload");
    expect(isGatedPath("/upload")).toBe(true);
    expect(isGatedPath("/upload/123")).toBe(true);
    expect(isGatedPath("/uploads")).toBe(false);
    expect(gateRedirect("/upload", "", false)).toBe("/sign-in?next=%2Fupload");
  });

  it("is extensible with more prefixes (#19 /review)", () => {
    const prefixes = [...GATED_PATH_PREFIXES, "/upload", "/review"];
    expect(isGatedPath("/upload", prefixes)).toBe(true);
    expect(isGatedPath("/review/123", prefixes)).toBe(true);
    expect(isGatedPath("/uploads-faq", prefixes)).toBe(false);
  });
});

describe("gateRedirect", () => {
  it("sends signed-out users on gated paths to sign-in with next", () => {
    expect(gateRedirect("/account", "?tab=1", false)).toBe(
      "/sign-in?next=%2Faccount%3Ftab%3D1",
    );
  });

  it("lets signed-in users and public paths through", () => {
    expect(gateRedirect("/account", "", true)).toBeNull();
    expect(gateRedirect("/", "", false)).toBeNull();
    expect(gateRedirect("/sign-in", "", false)).toBeNull();
  });

  it("builds sign-in paths that round-trip through URLSearchParams", () => {
    const url = new URL(signInPath("/account", "?a=1&b=2"), "http://x");
    expect(url.searchParams.get("next")).toBe("/account?a=1&b=2");
  });
});
