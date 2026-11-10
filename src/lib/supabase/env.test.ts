import { describe, expect, it } from "vitest";
import {
  SupabaseEnvError,
  getPublicSupabaseEnv,
  getServiceRoleKey,
  isSupabaseConfigured,
} from "./env";

// Shape of the keys `supabase start` prints locally (demo JWT, not a secret).
const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: JWT,
};

describe("getPublicSupabaseEnv", () => {
  it("returns url and anon key when both are valid", () => {
    expect(getPublicSupabaseEnv(valid)).toEqual({
      url: "http://127.0.0.1:54321",
      anonKey: JWT,
    });
  });

  it("accepts hosted sb_publishable_ keys and strips trailing slashes", () => {
    const env = getPublicSupabaseEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co/",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_abc123",
    });
    expect(env.url).toBe("https://abc.supabase.co");
    expect(env.anonKey).toBe("sb_publishable_abc123");
  });

  it("throws a named error pointing at .env.example when the URL is missing", () => {
    const run = () =>
      getPublicSupabaseEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: JWT });
    expect(run).toThrow(SupabaseEnvError);
    expect(run).toThrow(/NEXT_PUBLIC_SUPABASE_URL is not set/);
    expect(run).toThrow(/\.env\.example/);
  });

  it("treats whitespace-only values as missing", () => {
    expect(() =>
      getPublicSupabaseEnv({ ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: "  " }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY is not set/);
  });

  it("rejects a malformed URL", () => {
    expect(() =>
      getPublicSupabaseEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "localhost" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL is not a valid URL/);
  });

  it("rejects non-http(s) URLs", () => {
    expect(() =>
      getPublicSupabaseEnv({
        ...valid,
        NEXT_PUBLIC_SUPABASE_URL: "postgres://127.0.0.1:54322",
      }),
    ).toThrow(/must use http:\/\/ or https:\/\//);
  });

  it("rejects a key that is not a JWT or sb_ key", () => {
    expect(() =>
      getPublicSupabaseEnv({
        ...valid,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "paste-me",
      }),
    ).toThrow(/does not look like a Supabase API key/);
  });

  it("exposes the offending variable name on the error", () => {
    try {
      getPublicSupabaseEnv({});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SupabaseEnvError);
      expect((err as SupabaseEnvError).variable).toBe(
        "NEXT_PUBLIC_SUPABASE_URL",
      );
    }
  });
});

describe("isSupabaseConfigured", () => {
  it("is true for valid env and false otherwise, without throwing", () => {
    expect(isSupabaseConfigured(valid)).toBe(true);
    expect(isSupabaseConfigured({})).toBe(false);
    expect(
      isSupabaseConfigured({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "nope" }),
    ).toBe(false);
  });
});

describe("getServiceRoleKey", () => {
  // vitest runs these in jsdom, so `window` is defined: this IS the browser case.
  it("refuses to run where window exists", () => {
    expect(() => getServiceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: JWT })).toThrow(
      /must never be read in browser code/,
    );
  });

  // @vitest-environment-agnostic check: simulate server by hiding window.
  it("returns the key on the server and rejects missing/malformed values", () => {
    const win = globalThis.window;
    // @ts-expect-error -- deliberately removing jsdom's window for this test
    delete globalThis.window;
    try {
      expect(getServiceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: JWT })).toBe(JWT);
      expect(
        getServiceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: "sb_secret_xyz" }),
      ).toBe("sb_secret_xyz");
      expect(() => getServiceRoleKey({})).toThrow(
        /SUPABASE_SERVICE_ROLE_KEY is not set/,
      );
      expect(() =>
        getServiceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: "nope" }),
      ).toThrow(/does not look like a Supabase API key/);
    } finally {
      globalThis.window = win;
    }
  });
});
