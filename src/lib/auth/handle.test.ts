import {
  FALLBACK_HANDLE,
  HANDLE_PATTERN,
  handleSource,
  normalizeHandle,
  validateHandle,
  withSuffix,
} from "./handle";

describe("normalizeHandle", () => {
  it.each([
    ["octocat", "octocat"],
    ["Octo-Cat", "octo_cat"],
    ["Jane Doe", "jane_doe"],
    ["josé.núñez", "jose_nunez"],
    ["Ångström", "angstrom"],
    ["ｆｕｌｌｗｉｄｔｈ", "fullwidth"],
    ["a--b..c", "a_b_c"],
    ["__edge__", "edge"],
    ["user_123", "user_123"],
    ["李小龍", FALLBACK_HANDLE],
    ["🧗‍♀️ climber 🧗", "climber"],
    ["!!!", FALLBACK_HANDLE],
    ["", FALLBACK_HANDLE],
    ["   ", FALLBACK_HANDLE],
    ["jo", "jo_climber"],
    ["x", "x_climber"],
    ["é", "e_climber"],
  ])("%j -> %j", (raw, expected) => {
    expect(normalizeHandle(raw)).toBe(expected);
  });

  it("handles null/undefined", () => {
    expect(normalizeHandle(null)).toBe(FALLBACK_HANDLE);
    expect(normalizeHandle(undefined)).toBe(FALLBACK_HANDLE);
  });

  it("truncates to 32 and never ends on an underscore", () => {
    expect(normalizeHandle("a".repeat(50))).toBe("a".repeat(32));
    const h = normalizeHandle(`${"a".repeat(31)} b`);
    expect(h).toBe("a".repeat(31));
  });

  it("always satisfies the DB check", () => {
    const samples = ["", "a", "ab", "A B", "x".repeat(100), "-_-", "∑∂ƒ", "0"];
    for (const s of samples) expect(normalizeHandle(s)).toMatch(HANDLE_PATTERN);
  });
});

describe("withSuffix", () => {
  it("appends _n and keeps within 32 chars", () => {
    expect(withSuffix("octocat", 1234)).toBe("octocat_1234");
    const long = withSuffix("a".repeat(32), 1234);
    expect(long).toHaveLength(32);
    expect(long).toMatch(HANDLE_PATTERN);
    expect(long.endsWith("_1234")).toBe(true);
  });

  it("does not create a double underscore when truncation lands on one", () => {
    const base = `${"a".repeat(26)}_bbbbb`; // index 26 is "_"
    expect(withSuffix(base, 1234)).toBe(`${"a".repeat(26)}_1234`);
  });
});

describe("handleSource", () => {
  it("prefers the GitHub username", () => {
    expect(
      handleSource({ user_metadata: { user_name: "octocat", name: "Mona" } }),
    ).toBe("octocat");
    expect(
      handleSource({ user_metadata: { preferred_username: "mona" } }),
    ).toBe("mona");
  });

  it("uses the Google display name before the email local part", () => {
    expect(
      handleSource({
        user_metadata: { name: "Alex Honnold", email: "a.h@example.com" },
      }),
    ).toBe("Alex Honnold");
    expect(handleSource({ user_metadata: { full_name: "Lynn Hill" } })).toBe(
      "Lynn Hill",
    );
  });

  it("falls back to the email local part, never the domain", () => {
    expect(handleSource({ email: "chris.sharma@example.com" })).toBe(
      "chris.sharma",
    );
    expect(handleSource({ user_metadata: { email: "ab@x.io" } })).toBe("ab");
  });

  it("ignores blank/non-string metadata", () => {
    expect(
      handleSource({ user_metadata: { user_name: "  ", name: 42 } }),
    ).toBeUndefined();
    expect(handleSource({ user_metadata: null })).toBeUndefined();
  });
});

describe("validateHandle", () => {
  it("accepts valid handles, trimming and lowercasing", () => {
    expect(validateHandle("abc")).toEqual({ ok: true, handle: "abc" });
    expect(validateHandle("  New_Name9 ")).toEqual({
      ok: true,
      handle: "new_name9",
    });
    expect(validateHandle("a".repeat(32))).toMatchObject({ ok: true });
  });

  it.each([
    ["", /Enter a handle/],
    [null, /Enter a handle/],
    ["ab", /at least 3/],
    ["a".repeat(33), /at most 32/],
    ["has space", /lowercase letters/],
    ["dash-ed", /lowercase letters/],
    ["émile", /lowercase letters/],
  ])("rejects %j", (input, message) => {
    const r = validateHandle(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it("agrees with the DB pattern on every accepted value", () => {
    for (const s of ["abc", "ABC", "a_b_c", "x".repeat(32), "123"]) {
      const r = validateHandle(s);
      if (r.ok) expect(r.handle).toMatch(HANDLE_PATTERN);
    }
  });
});
