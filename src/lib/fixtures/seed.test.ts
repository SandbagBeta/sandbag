// @vitest-environment node
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_PATHS,
  fixtureRows,
  isLocalSupabaseUrl,
  PUBLISH_ROUTE,
  runSeed,
  STORAGE_BUCKET,
  STORAGE_PATH,
  validateFixtures,
} from "../../../scripts/lib/seed-core.mjs";

type Row = { id: string; status?: string };
type DbError = null | { message: string };

/**
 * In-memory stand-in for the supabase-js calls the seed makes: storage
 * upload, upsert (which, like Postgres ON CONFLICT DO UPDATE, keeps columns
 * the payload omits) and `select(...).in("id", ids)`. `applyTransition`
 * moves status the way the lifecycle module does, refusing stale `from`s.
 */
function mockSupabase({
  uploadError = null,
  upsertError = null,
}: { uploadError?: DbError; upsertError?: DbError } = {}) {
  const defaults: Record<string, string> = {
    scans: "uploaded",
    climbs: "pending_review",
  };
  const tables = new Map<string, Map<string, Row>>();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };

  const upload = vi.fn(async () => ({ error: uploadError }));
  const upsert = vi.fn(async (name: string, rows: Row[]) => {
    if (upsertError) return { error: upsertError };
    for (const row of rows) {
      const prev = table(name).get(row.id);
      table(name).set(row.id, {
        ...(prev ?? (defaults[name] ? { status: defaults[name] } : {})),
        ...row,
      });
    }
    return { error: null };
  });
  const db = {
    storage: { from: vi.fn(() => ({ upload })) },
    from: (name: string) => ({
      upsert: (rows: Row[]) => upsert(name, rows),
      select: () => ({
        in: async (_col: string, ids: string[]) => ({
          data: ids
            .map((id) => table(name).get(id))
            .filter(Boolean)
            .map((r) => ({ id: r!.id, status: r!.status })),
          error: null,
        }),
      }),
    }),
  };
  const createClient = vi.fn(() => db);
  const applyTransition = vi.fn(
    async (
      _db: unknown,
      req: { kind: "scan" | "climb"; id: string; from: string; to: string },
    ) => {
      const row = table(req.kind === "scan" ? "scans" : "climbs").get(req.id);
      if (row?.status !== req.from) throw new Error(`conflict on ${req.id}`);
      row.status = req.to;
    },
  );
  return { createClient, applyTransition, upload, upsert, table, db };
}

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
};

describe("validateFixtures", () => {
  it("accepts the committed fixture pair", async () => {
    const info = await validateFixtures();
    expect(info.bytes).toBeLessThan(10 * 1024 * 1024);
    expect(info.climbs).toBe(2);
    expect(info.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a holds JSON whose content hash does not match the GLB", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sandbag-seed-"));
    const fixture = JSON.parse(await readFile(DEFAULT_PATHS.holds, "utf8"));
    fixture.scan.content_hash = "0".repeat(64);
    const holds = join(dir, "demo-boulder.json");
    await writeFile(holds, JSON.stringify(fixture));
    await expect(
      validateFixtures({ glb: DEFAULT_PATHS.glb, holds }),
    ).rejects.toThrow(/content_hash .* does not match/);
  });

  it("explains how to fix a missing GLB", async () => {
    await expect(
      validateFixtures({
        glb: "/nonexistent/demo.glb",
        holds: DEFAULT_PATHS.holds,
      }),
    ).rejects.toThrow(/pnpm fixtures:generate/);
  });
});

describe("fixtureRows", () => {
  it("maps the fixture onto schema v1 columns with no status and null authors", async () => {
    const fixture = JSON.parse(await readFile(DEFAULT_PATHS.holds, "utf8"));
    const rows = fixtureRows(fixture);
    expect(rows.scan).not.toHaveProperty("status");
    expect(rows.scan).not.toHaveProperty("public_url");
    expect(rows.scan.uploader_id).toBeNull();
    expect(rows.scan.glb_path).toBe(STORAGE_PATH);
    expect(rows.climbs).toHaveLength(2);
    for (const climb of rows.climbs) {
      expect(climb).not.toHaveProperty("status");
      expect(climb.created_by).toBeNull();
      expect(climb.scan_id).toBe(rows.scan.id);
    }
    expect(rows.holds).toHaveLength(14);
    expect(rows.paths).toHaveLength(6);
  });

  it("does not mutate the fixture it reads", async () => {
    const fixture = JSON.parse(await readFile(DEFAULT_PATHS.holds, "utf8"));
    const before = JSON.stringify(fixture);
    fixtureRows(fixture);
    expect(JSON.stringify(fixture)).toBe(before);
  });
});

describe("runSeed", () => {
  it("skips upload and DB writes without Supabase credentials", async () => {
    const { createClient, applyTransition } = mockSupabase();
    const log = vi.fn();
    const result = await runSeed({
      env: {},
      createClient,
      applyTransition,
      log,
    });
    expect(result.uploaded).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
    expect(applyTransition).not.toHaveBeenCalled();
    const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/storage \+ DB rows: skipped/);
  });

  it("inserts the demo rows and publishes them only through applyTransition", async () => {
    const { createClient, applyTransition, upsert, table } = mockSupabase();
    const result = await runSeed({
      env,
      createClient,
      applyTransition,
      log: vi.fn(),
    });
    expect(upsert.mock.calls.map((c) => c[0])).toEqual([
      "scans",
      "climbs",
      "holds",
      "paths",
    ]);
    for (const [, rows] of upsert.mock.calls) {
      for (const row of rows) expect(row).not.toHaveProperty("status");
    }
    expect(table("scans").size).toBe(1);
    expect(table("climbs").size).toBe(2);
    expect(table("holds").size).toBe(14);
    expect(table("paths").size).toBe(6);
    expect([...table("scans").values()][0]!.status).toBe("published");
    for (const climb of table("climbs").values()) {
      expect(climb.status).toBe("published");
    }
    // scan: 3 hops, each climb: 1 hop
    expect(applyTransition).toHaveBeenCalledTimes(
      PUBLISH_ROUTE.scan.length - 1 + 2 * (PUBLISH_ROUTE.climb.length - 1),
    );
    expect(applyTransition.mock.calls[0]![1]).toMatchObject({
      kind: "scan",
      from: "uploaded",
      to: "processing",
    });
    expect(result.published).toBe(3);
  });

  it("is idempotent: a second run adds no rows and makes no transitions", async () => {
    const mock = mockSupabase();
    const opts = {
      env,
      createClient: mock.createClient,
      applyTransition: mock.applyTransition,
      log: vi.fn(),
    };
    await runSeed(opts);
    mock.applyTransition.mockClear();
    const log = vi.fn();
    const second = await runSeed({ ...opts, log });
    expect(second.published).toBe(0);
    expect(mock.applyTransition).not.toHaveBeenCalled();
    expect(mock.table("climbs").size).toBe(2);
    expect(mock.table("holds").size).toBe(14);
    expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(
      /already published/,
    );
  });

  it("resumes a half-published scan from its current status", async () => {
    const mock = mockSupabase();
    const opts = {
      env,
      createClient: mock.createClient,
      applyTransition: mock.applyTransition,
      log: vi.fn(),
    };
    await runSeed(opts);
    [...mock.table("scans").values()][0]!.status = "pending_review";
    mock.applyTransition.mockClear();
    await runSeed(opts);
    expect(mock.applyTransition).toHaveBeenCalledTimes(1);
    expect(mock.applyTransition.mock.calls[0]![1]).toMatchObject({
      from: "pending_review",
      to: "published",
    });
    expect([...mock.table("scans").values()][0]!.status).toBe("published");
  });

  it("explains how to recover when a demo row cannot reach published", async () => {
    const mock = mockSupabase();
    const opts = {
      env,
      createClient: mock.createClient,
      applyTransition: mock.applyTransition,
      log: vi.fn(),
    };
    await runSeed(opts);
    [...mock.table("scans").values()][0]!.status = "rejected";
    await expect(runSeed(opts)).rejects.toThrow(
      /is rejected, which cannot reach published.*supabase db reset/,
    );
  });

  it("surfaces DB write errors", async () => {
    const { createClient, applyTransition } = mockSupabase({
      upsertError: { message: "permission denied" },
    });
    await expect(
      runSeed({ env, createClient, applyTransition, log: vi.fn() }),
    ).rejects.toThrow(/upsert into scans failed: permission denied/);
    expect(applyTransition).not.toHaveBeenCalled();
  });

  it("requires applyTransition when credentials are set", async () => {
    const { createClient } = mockSupabase();
    await expect(runSeed({ env, createClient, log: vi.fn() })).rejects.toThrow(
      /needs applyTransition/,
    );
  });

  it("upserts the GLB to published/demo/demo-boulder.glb when credentials are set", async () => {
    const { createClient, applyTransition, db, upload } = mockSupabase();
    const result = await runSeed({
      env,
      createClient,
      applyTransition,
      log: vi.fn(),
    });
    expect(result.uploaded).toBe(true);
    expect(createClient).toHaveBeenCalledWith(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
    );
    expect(STORAGE_BUCKET).toBe("published");
    expect(db.storage.from).toHaveBeenCalledWith(STORAGE_BUCKET);
    expect(upload).toHaveBeenCalledTimes(1);
    const [path, body, options] = upload.mock.calls[0] as unknown as [
      string,
      Uint8Array,
      { upsert: boolean; contentType: string },
    ];
    expect(path).toBe(STORAGE_PATH);
    expect(body.byteLength).toBeGreaterThan(0);
    expect(options).toMatchObject({
      upsert: true,
      contentType: "model/gltf-binary",
    });
  });

  it("refuses a non-local Supabase URL without --force and never creates a client", async () => {
    const { createClient, applyTransition } = mockSupabase();
    const remote = {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    };
    await expect(
      runSeed({ env: remote, createClient, applyTransition, log: vi.fn() }),
    ).rejects.toThrow(
      /refusing to upload.*not a local stack.*pnpm seed --force/,
    );
    expect(createClient).not.toHaveBeenCalled();
    expect(applyTransition).not.toHaveBeenCalled();
  });

  it("uploads to a non-local Supabase URL when force is set", async () => {
    const { createClient, applyTransition, upload } = mockSupabase();
    const remote = {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    };
    const result = await runSeed({
      env: remote,
      createClient,
      applyTransition,
      log: vi.fn(),
      force: true,
    });
    expect(result.uploaded).toBe(true);
    expect(createClient).toHaveBeenCalledWith(
      remote.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
    );
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("treats localhost and 127.0.0.1 as local, anything else as remote", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://localhost:54321")).toBe(true);
    expect(isLocalSupabaseUrl("https://abc.supabase.co")).toBe(false);
    expect(isLocalSupabaseUrl("http://127.0.0.1.evil.example")).toBe(false);
    expect(isLocalSupabaseUrl("not a url")).toBe(false);
  });

  it("surfaces storage errors before touching the database", async () => {
    const { createClient, applyTransition, upsert } = mockSupabase({
      uploadError: { message: "bucket not found" },
    });
    await expect(
      runSeed({ env, createClient, applyTransition, log: vi.fn() }),
    ).rejects.toThrow(
      /published\/demo\/demo-boulder.glb failed: bucket not found/,
    );
    expect(upsert).not.toHaveBeenCalled();
  });
});
