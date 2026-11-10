import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it.each([
    ["/", "/"],
    ["/account", "/account"],
    ["/account?tab=handle#top", "/account?tab=handle#top"],
    ["/boulders/abc-123", "/boulders/abc-123"],
    ["/a/../account", "/account"],
    ["/search?q=a%20b", "/search?q=a%20b"],
  ])("allows same-origin path %j", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    "//evil.com",
    "//evil.com/account",
    "///evil.com",
    "https://evil.com",
    "http://evil.com/account",
    "javascript:alert(1)",
    "evil.com",
    "account",
    "/\\evil.com",
    "\\\\evil.com",
    "\\/evil.com",
    "/path\\with\\backslash",
    "%2F%2Fevil.com",
    "/%2Fevil.com",
    "/%5Cevil.com",
    "%5C%5Cevil.com",
    "/%252F%252Fevil.com",
    "/%E0%A4%A",
    "/\tevil",
    "/\n/evil.com",
    "/\u0000",
    "",
  ])("rejects %j", (raw) => {
    expect(safeNextPath(raw)).toBe("/");
  });

  it("rejects non-strings and oversize values, using the fallback", () => {
    expect(safeNextPath(null, "/account")).toBe("/account");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(["/account"])).toBe("/");
    expect(safeNextPath(`/${"a".repeat(3000)}`)).toBe("/");
  });

  it("never returns something that resolves off-origin", () => {
    const base = "https://sandbag.example";
    for (const raw of ["/x", "//evil.com", "/\\evil.com", "%2F%2Fevil.com"]) {
      expect(new URL(safeNextPath(raw), base).origin).toBe(base);
    }
  });
});
