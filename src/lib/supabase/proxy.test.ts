// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, vi } from "vitest";

const getClaims = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: unknown[], h: Record<string, string>) => void };
    },
  ) => ({
    auth: {
      getClaims: async () => {
        // Simulate a token refresh writing a new session cookie.
        opts.cookies.setAll(
          [
            {
              name: "sb-test-auth-token",
              value: "fresh",
              options: { path: "/" },
            },
          ],
          { "Cache-Control": "private, no-store" },
        );
        return getClaims();
      },
    },
  }),
}));

const { updateSession } = await import("./proxy");

const req = (path: string) =>
  new NextRequest(new URL(path, "http://localhost:3000"));
const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test",
};

describe("updateSession without Supabase configured", () => {
  it("still gates /account and leaves public pages alone", async () => {
    const gated = await updateSession(req("/account"));
    expect(gated.headers.get("location")).toBe(
      "http://localhost:3000/sign-in?next=%2Faccount",
    );
    const open = await updateSession(req("/"));
    expect(open.headers.get("location")).toBeNull();
  });
});

describe("updateSession with Supabase configured", () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    getClaims.mockReset();
  });

  it("redirects signed-out users from gated paths, keeping refreshed cookies", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const res = await updateSession(req("/account/x?y=1"));
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/sign-in?next=%2Faccount%2Fx%3Fy%3D1",
    );
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("fresh");
  });

  it("lets signed-in users through with the refreshed cookie and cache headers", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "u1" } },
      error: null,
    });
    const res = await updateSession(req("/account"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("fresh");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("never redirects public paths", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    expect((await updateSession(req("/"))).headers.get("location")).toBeNull();
  });
});
