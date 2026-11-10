import {
  Upload,
  type DetailedError,
  type HttpRequest,
  type HttpResponse,
  type HttpStack,
  type PreviousUpload,
  type UrlStorage,
} from "tus-js-client";
import {
  buildTusOptions,
  describeUploadError,
  shouldRetryUpload,
  TUS_CHUNK_SIZE,
  tusEndpoint,
  uploadFingerprint,
  type TusConfig,
} from "./tus";

// Vitest resolves tus-js-client's Node build, which can't read a Blob. Use
// the browser build, which is what Next.js bundles for the upload page.
vi.mock("tus-js-client", () =>
  vi.importActual<typeof import("tus-js-client")>(
    "tus-js-client/lib.esm/browser/index.js",
  ),
);

const MB = 1024 * 1024;
const USER = "00000000-0000-4000-8000-0000000000a1";
const KEY = `${USER}/20000000-0000-4000-8000-0000000000a1/raw/source.ply`;

let tokenN = 0;
const cfg = (over: Partial<TusConfig> = {}): TusConfig => ({
  supabaseUrl: "http://127.0.0.1:54321",
  anonKey: "anon.key.jwt",
  userId: USER,
  objectName: KEY,
  contentType: "application/octet-stream",
  getAccessToken: async () => `token-${++tokenN}`,
  ...over,
});

describe("buildTusOptions", () => {
  it("uses Supabase's required 6 MB chunks, the agreed retry delays, and no upsert", () => {
    const o = buildTusOptions(cfg());
    expect(TUS_CHUNK_SIZE).toBe(6 * MB);
    expect(o.chunkSize).toBe(6 * MB);
    expect(o.retryDelays).toEqual([0, 1000, 3000, 5000, 10000, 20000]);
    expect(o.endpoint).toBe(
      "http://127.0.0.1:54321/storage/v1/upload/resumable",
    );
    expect(o.headers).toEqual({ apikey: "anon.key.jwt", "x-upsert": "false" });
    expect(o.metadata).toEqual({
      bucketName: "uploads",
      objectName: KEY,
      contentType: "application/octet-stream",
      cacheControl: "3600",
    });
    expect(o.storeFingerprintForResuming).toBe(true);
    expect(o.removeFingerprintOnSuccess).toBe(true);
    expect(o.uploadDataDuringCreation).toBe(true);
  });

  it("fingerprints by user, endpoint and file, not by scan", async () => {
    const file = { name: "a.ply", size: 10, type: "", lastModified: 5 };
    const a = await buildTusOptions(cfg()).fingerprint!(
      file as unknown as File,
      {},
    );
    const b = await buildTusOptions(cfg({ objectName: "" })).fingerprint!(
      file as unknown as File,
      {},
    );
    expect(a).toBe(b);
    expect(a).toBe(
      uploadFingerprint(USER, tusEndpoint("http://127.0.0.1:54321"), file),
    );
    expect(a).not.toBe(
      uploadFingerprint(
        "someone-else",
        tusEndpoint("http://127.0.0.1:54321"),
        file,
      ),
    );
  });

  it("uses the direct storage host for hosted projects", () => {
    expect(tusEndpoint("https://abcd1234.supabase.co")).toBe(
      "https://abcd1234.storage.supabase.co/storage/v1/upload/resumable",
    );
    expect(tusEndpoint("https://supabase.example.org/")).toBe(
      "https://supabase.example.org/storage/v1/upload/resumable",
    );
  });

  it("fails the request when the session is gone", async () => {
    const o = buildTusOptions(cfg({ getAccessToken: async () => null }));
    const req = { setHeader: vi.fn() } as unknown as HttpRequest;
    await expect(o.onBeforeRequest!(req)).rejects.toThrow(/session expired/);
  });
});

const errWith = (status: number, body = "") =>
  ({
    originalResponse: status
      ? { getStatus: () => status, getBody: () => body }
      : null,
  }) as unknown as DetailedError;

describe("shouldRetryUpload", () => {
  it.each([
    [0, "", 0, true],
    [502, "", 3, true],
    [409, "", 0, true],
    [423, "", 0, true],
    [429, "", 0, true],
    [401, "", 0, true],
    [401, "", 2, false],
    [400, '{"message":"jwt expired"}', 0, true],
    [403, "new row violates row-level security policy", 0, false],
    [413, "", 0, false],
    [400, "invalid mime type", 0, false],
  ])("status %d body %j attempt %d -> %s", (status, body, attempt, want) => {
    expect(shouldRetryUpload(errWith(status, body), attempt)).toBe(want);
  });

  it("explains the hosted 50 MB cap on 413", () => {
    expect(describeUploadError(errWith(413))).toMatch(/50 MB/);
    expect(describeUploadError(new Error("offline"))).toMatch(/Retry/);
  });
});

// ---------------------------------------------------------------------------
// A fake TUS server (in-process HttpStack) for the "flaky wifi" acceptance.

type Log = { method: string; offset?: number; bytes: number; auth?: string };

function bodySize(body: unknown): number {
  if (body == null) return 0;
  if (body instanceof Blob) return body.size;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  throw new Error(`unexpected body ${Object.prototype.toString.call(body)}`);
}

function fakeTusServer(opts: { dropPatch?: number } = {}) {
  const uploads = new Map<string, { offset: number; length: number }>();
  const log: Log[] = [];
  let patches = 0;
  const res = (
    status: number,
    headers: Record<string, string> = {},
  ): HttpResponse => ({
    getStatus: () => status,
    getHeader: (h) => headers[h.toLowerCase()] ?? headers[h],
    getBody: () => "",
    getUnderlyingObject: () => null,
  });
  const stack: HttpStack = {
    getName: () => "fake",
    createRequest(method, url) {
      const headers: Record<string, string> = {};
      const req: HttpRequest = {
        getMethod: () => method,
        getURL: () => url,
        setHeader: (k, v) => void (headers[k] = v),
        getHeader: (k) => headers[k],
        setProgressHandler: () => {},
        abort: async () => {},
        getUnderlyingObject: () => null,
        async send(body) {
          const bytes = bodySize(body);
          const entry: Log = { method, bytes, auth: headers.Authorization };
          log.push(entry);
          if (method === "POST") {
            const id = `${url}/u${uploads.size + 1}`;
            uploads.set(id, {
              offset: bytes,
              length: Number(headers["Upload-Length"]),
            });
            return res(201, { location: id, "upload-offset": String(bytes) });
          }
          const u = uploads.get(url);
          if (!u) return res(404);
          if (method === "HEAD") {
            return res(200, {
              "upload-offset": String(u.offset),
              "upload-length": String(u.length),
            });
          }
          entry.offset = Number(headers["Upload-Offset"]);
          if (entry.offset !== u.offset) return res(409);
          patches++;
          u.offset += bytes;
          // The chunk reached the server but the reply was lost: Wi-Fi dropped.
          if (patches === opts.dropPatch) throw new Error("network down");
          return res(204, { "upload-offset": String(u.offset) });
        },
      };
      return req;
    },
  };
  return { stack, log, uploads };
}

function memoryUrlStorage(): UrlStorage {
  const items = new Map<string, PreviousUpload & { fingerprint: string }>();
  return {
    findAllUploads: async () => [...items.values()],
    findUploadsByFingerprint: async (fp) =>
      [...items.values()].filter((u) => u.fingerprint === fp),
    removeUpload: async (key) => void items.delete(key),
    addUpload: async (fingerprint, upload) => {
      const key = `k${items.size + 1}`;
      items.set(key, { ...upload, fingerprint, urlStorageKey: key });
      return key;
    },
  };
}

const file = () =>
  new File([new Uint8Array(15 * MB)], "scan.ply", { lastModified: 1 });

function run(upload: Upload): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.options.onSuccess = () => resolve();
    upload.options.onError = reject;
    upload.start();
  });
}

describe("resumable upload over a flaky connection", () => {
  it("resumes from the server's last offset after a chunk fails mid-upload", async () => {
    const server = fakeTusServer({ dropPatch: 1 });
    const f = file();
    const upload = new Upload(f, {
      ...buildTusOptions(cfg()),
      httpStack: server.stack,
      urlStorage: memoryUrlStorage(),
    });
    await run(upload);

    const methods = server.log.map((l) => l.method);
    // POST carries chunk 1; PATCH (chunk 2) is lost; HEAD asks where we are;
    // the next PATCH continues at 12 MB instead of starting over.
    expect(methods).toEqual(["POST", "PATCH", "HEAD", "PATCH"]);
    const patches = server.log.filter((l) => l.method === "PATCH");
    expect(patches.map((p) => p.offset)).toEqual([6 * MB, 12 * MB]);
    expect(server.log.reduce((n, l) => n + l.bytes, 0)).toBe(f.size);
    expect(Math.max(...server.log.map((l) => l.bytes))).toBe(TUS_CHUNK_SIZE);
    expect([...server.uploads.values()][0]!.offset).toBe(f.size);
    // A fresh bearer token is fetched for every request, retries included.
    expect(new Set(server.log.map((l) => l.auth)).size).toBe(server.log.length);
    expect(server.log.every((l) => l.auth?.startsWith("Bearer token-"))).toBe(
      true,
    );
  });

  it("after a reload, finds the stored upload and continues from the last chunk", async () => {
    const server = fakeTusServer();
    const urlStorage = memoryUrlStorage();
    const opts = {
      ...buildTusOptions(cfg()),
      httpStack: server.stack,
      urlStorage,
    };

    const first = new Upload(file(), opts);
    await new Promise<void>((resolve) => {
      first.options.onChunkComplete = (_c, accepted) => {
        if (accepted >= 6 * MB) {
          void first.abort();
          resolve();
        }
      };
      first.start();
    });
    server.log.length = 0;

    // "Page reload": a new Upload for the same file, user and endpoint.
    const probe = new Upload(file(), opts);
    const previous = await probe.findPreviousUploads();
    expect(previous).toHaveLength(1);
    expect(previous[0]!.metadata.objectName).toBe(KEY);

    const second = new Upload(file(), opts);
    second.resumeFromPreviousUpload(previous[0]!);
    await run(second);
    expect(server.log.map((l) => l.method)).toEqual(["HEAD", "PATCH", "PATCH"]);
    expect(server.log[1]!.offset).toBe(6 * MB);
    expect(await urlStorage.findAllUploads()).toEqual([]); // removed on success
  });
});
