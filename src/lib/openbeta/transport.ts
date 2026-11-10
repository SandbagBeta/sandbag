/**
 * HTTP side of the OpenBeta client (ADR 001 §2): one global throttle, a 10 s
 * timeout, exponential backoff on 429/5xx, and errors that carry a short code
 * only, never a response body.
 *
 * The throttle is module state, so it is global PER SERVER INSTANCE. Each
 * Vercel function instance has its own queue; N warm instances can send up
 * to N req/s in total. The cache keeps that rare (about one request per area
 * per week), and a shared limiter would need Redis or a DB lock.
 */

export const OPENBETA_ENDPOINT = "https://api.openbeta.io/";
export const USER_AGENT =
  "SandBag/0.1.0 (+https://github.com/sandbagbeta/sandbag)";
export const TIMEOUT_MS = 10_000;
const BACKOFF_START_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60_000;
const RETRY_AFTER_MAX_MS = 60 * 60_000;

/** Short, body-free failure code. Safe to store in `last_error` and to log. */
export type OpenBetaErrorCode =
  | "timeout"
  | "network"
  | "backoff"
  | "bad_response"
  | "graphql_error"
  | `http_${number}`;

export class OpenBetaError extends Error {
  constructor(
    readonly code: OpenBetaErrorCode,
    /** True when the throttle should back off (429, 5xx, timeout, network). */
    readonly retryable = false,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`[openbeta] ${code}`);
    this.name = "OpenBetaError";
  }
}

export const errorCode = (err: unknown): OpenBetaErrorCode =>
  err instanceof OpenBetaError ? err.code : "network";

/** `Retry-After` as delta-seconds or an HTTP date; null when absent or unusable. */
export function parseRetryAfter(value: string | null, now: number) {
  if (!value) return null;
  const ms = /^\d+$/.test(value.trim())
    ? Number(value) * 1000
    : Date.parse(value) - now;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.min(ms, RETRY_AFTER_MAX_MS);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Serial queue: one task in flight, starts at least `minIntervalMs` apart.
 * After a retryable failure it blocks for 2 s, 4 s, 8 s ... (cap 5 min), or
 * for `Retry-After` when the server sends one. Tasks that reach the front
 * while blocked fail fast with `backoff` instead of waiting: callers serve
 * the cache, and OpenBeta gets no traffic until the window ends.
 */
export class Throttle {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStart = -Infinity;
  private failures = 0;
  private blockedUntil = 0;

  constructor(private readonly minIntervalMs = 1000) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      if (Date.now() < this.blockedUntil) throw new OpenBetaError("backoff");
      const wait = this.lastStart + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastStart = Date.now();
      try {
        const value = await task();
        this.failures = 0;
        return value;
      } catch (err) {
        if (err instanceof OpenBetaError && err.retryable) {
          this.failures += 1;
          const exp = Math.min(
            BACKOFF_START_MS * 2 ** (this.failures - 1),
            BACKOFF_MAX_MS,
          );
          this.blockedUntil = Date.now() + (err.retryAfterMs ?? exp);
        }
        throw err;
      }
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export const defaultThrottle = new Throttle();

export interface TransportOptions {
  fetch?: typeof fetch;
  throttle?: Throttle;
}

/** POST one GraphQL query through the throttle. Resolves to `data`. */
export function postGraphQL(
  query: string,
  variables: Record<string, unknown>,
  opts: TransportOptions = {},
): Promise<unknown> {
  const doFetch = opts.fetch ?? fetch;
  return (opts.throttle ?? defaultThrottle).run(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      let res: Response;
      let text: string;
      try {
        res = await doFetch(OPENBETA_ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            "user-agent": USER_AGENT,
          },
          body: JSON.stringify({ query, variables }),
          signal: ctrl.signal,
        });
        if (res.status === 429 || res.status >= 500) {
          const after = parseRetryAfter(
            res.headers.get("retry-after"),
            Date.now(),
          );
          throw new OpenBetaError(`http_${res.status}`, true, after);
        }
        if (!res.ok) throw new OpenBetaError(`http_${res.status}`);
        text = await res.text();
      } catch (err) {
        if (err instanceof OpenBetaError) throw err;
        throw new OpenBetaError(
          ctrl.signal.aborted ? "timeout" : "network",
          true,
        );
      }
      // Cloudflare occasionally answers 200 with an HTML page (seen live).
      let body: { data?: unknown; errors?: unknown[] };
      try {
        body = JSON.parse(text);
      } catch {
        throw new OpenBetaError("bad_response");
      }
      if (Array.isArray(body?.errors) && body.errors.length) {
        throw new OpenBetaError("graphql_error");
      }
      if (body?.data == null) throw new OpenBetaError("bad_response");
      return body.data;
    } finally {
      clearTimeout(timer);
    }
  });
}
