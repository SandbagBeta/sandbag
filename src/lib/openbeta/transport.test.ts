// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenBetaError,
  OPENBETA_ENDPOINT,
  parseRetryAfter,
  postGraphQL,
  Throttle,
  USER_AGENT,
} from "./transport";

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), init);

/** Settle a promise without letting an expected rejection go unhandled. */
const settle = <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

describe("Throttle", () => {
  it("runs tasks one at a time, in order, at least 1 s apart", async () => {
    const t = new Throttle();
    const starts: [string, number][] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const task = (name: string) => async () => {
      starts.push([name, Date.now()]);
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await new Promise((r) => setTimeout(r, 300));
      inFlight--;
      return name;
    };
    const all = Promise.all(["a", "b", "c"].map((n) => t.run(task(n))));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await all).toEqual(["a", "b", "c"]);
    expect(starts).toEqual([
      ["a", 0],
      ["b", 1000],
      ["c", 2000],
    ]);
    expect(maxInFlight).toBe(1);
  });

  it("a failed task does not stall the queue", async () => {
    const t = new Throttle();
    const a = settle(t.run(async () => Promise.reject(new Error("x"))));
    const b = t.run(async () => "b");
    await vi.advanceTimersByTimeAsync(1000);
    expect((await a).ok).toBe(false);
    expect(await b).toBe("b");
  });

  it("doubles the window per consecutive failure, capped at 5 min", async () => {
    const t = new Throttle(0);
    const fail = () => Promise.reject(new OpenBetaError("http_429", true));
    const waits: number[] = [];
    for (let i = 0; i < 10; i++) {
      await settle(t.run(fail));
      const start = Date.now();
      // While blocked, tasks fail fast with `backoff` and never run.
      const ran = vi.fn(async () => 1);
      const blocked = await settle(t.run(ran));
      expect(blocked.ok).toBe(false);
      expect((blocked as { error: OpenBetaError }).error.code).toBe("backoff");
      expect(ran).not.toHaveBeenCalled();
      // Find when the window opens, to the second.
      let opened = false;
      while (!opened) {
        await vi.advanceTimersByTimeAsync(1000);
        opened =
          Date.now() >= (t as unknown as { blockedUntil: number }).blockedUntil;
      }
      waits.push(Date.now() - start);
    }
    expect(waits).toEqual([
      2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 300000, 300000,
    ]);
    await expect(t.run(async () => "ok")).resolves.toBe("ok");
    // A success resets the exponent.
    await settle(t.run(fail));
    expect(
      (t as unknown as { blockedUntil: number }).blockedUntil - Date.now(),
    ).toBe(2000);
  });

  it("honours Retry-After over the exponential window", async () => {
    const t = new Throttle(0);
    await settle(
      t.run(() => Promise.reject(new OpenBetaError("http_429", true, 30_000))),
    );
    await vi.advanceTimersByTimeAsync(29_000);
    expect((await settle(t.run(async () => 1))).ok).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(t.run(async () => 1)).resolves.toBe(1);
  });

  it("non-retryable errors do not trigger backoff", async () => {
    const t = new Throttle(0);
    await settle(
      t.run(() => Promise.reject(new OpenBetaError("graphql_error"))),
    );
    await expect(t.run(async () => 1)).resolves.toBe(1);
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates, ignores junk", () => {
    expect(parseRetryAfter("120", 0)).toBe(120_000);
    expect(parseRetryAfter(new Date(5000).toUTCString(), 0)).toBe(5000);
    expect(parseRetryAfter("soon", 0)).toBeNull();
    expect(parseRetryAfter(null, 0)).toBeNull();
    expect(parseRetryAfter("999999", 0)).toBe(3_600_000);
  });
});

describe("postGraphQL", () => {
  it("POSTs JSON with the generic User-Agent and returns data", async () => {
    const fetch = vi.fn(async () => json({ data: { ok: 1 } }));
    const out = await postGraphQL(
      "query Q { x }",
      { a: 1 },
      {
        fetch,
        throttle: new Throttle(),
      },
    );
    expect(out).toEqual({ ok: 1 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENBETA_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["user-agent"]).toBe(
      USER_AGENT,
    );
    expect(USER_AGENT).not.toMatch(/@/);
    expect(JSON.parse(init.body as string)).toEqual({
      query: "query Q { x }",
      variables: { a: 1 },
    });
  });

  it("times out after 10 s as a retryable `timeout`", async () => {
    const fetch = vi.fn(
      (_: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init!.signal!.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    const p = settle(
      postGraphQL(
        "q",
        {},
        { fetch: fetch as typeof globalThis.fetch, throttle: new Throttle() },
      ),
    );
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const r = await p;
    expect(r.ok).toBe(false);
    const err = (r as { error: OpenBetaError }).error;
    expect(err.code).toBe("timeout");
    expect(err.retryable).toBe(true);
  });

  it.each([
    [
      json({}, { status: 429, headers: { "retry-after": "7" } }),
      "http_429",
      7000,
    ],
    [json({}, { status: 503 }), "http_503", null],
  ])(
    "maps %#: 429/5xx are retryable and carry Retry-After",
    async (res, code, after) => {
      const r = await settle(
        postGraphQL(
          "q",
          {},
          { fetch: async () => res, throttle: new Throttle() },
        ),
      );
      const err = (r as { error: OpenBetaError }).error;
      expect(err).toMatchObject({ code, retryable: true, retryAfterMs: after });
    },
  );

  it("an HTML 200 (seen live from the edge) is `bad_response`; GraphQL errors are `graphql_error`", async () => {
    const html = new Response("<!DOCTYPE html><p>secret 42.3, -71.1</p>");
    const r1 = await settle(
      postGraphQL(
        "q",
        {},
        { fetch: async () => html, throttle: new Throttle() },
      ),
    );
    const e1 = (r1 as { error: OpenBetaError }).error;
    expect(e1.code).toBe("bad_response");
    expect(e1.message).toBe("[openbeta] bad_response");
    const r2 = await settle(
      postGraphQL(
        "q",
        {},
        {
          fetch: async () => json({ errors: [{ message: "near 42.3" }] }),
          throttle: new Throttle(),
        },
      ),
    );
    expect((r2 as { error: OpenBetaError }).error.message).toBe(
      "[openbeta] graphql_error",
    );
  });
});
