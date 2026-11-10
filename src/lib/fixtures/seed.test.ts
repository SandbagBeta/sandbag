// @vitest-environment node
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_PATHS,
  isLocalSupabaseUrl,
  runSeed,
  STORAGE_BUCKET,
  STORAGE_PATH,
  validateFixtures,
} from "../../../scripts/lib/seed-core.mjs";

function mockSupabase(
  result: { error: null | { message: string } } = { error: null },
) {
  const upload = vi.fn(async () => result);
  const from = vi.fn(() => ({ upload }));
  const createClient = vi.fn(() => ({ storage: { from } }));
  return { createClient, from, upload };
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

describe("runSeed", () => {
  it("skips upload and DB writes without Supabase credentials", async () => {
    const { createClient } = mockSupabase();
    const log = vi.fn();
    const result = await runSeed({ env: {}, createClient, log });
    expect(result.uploaded).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
    const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/storage: skipped/);
    expect(logged).toMatch(/DB rows: skipped/);
  });

  it("upserts the GLB to published/demo/demo-boulder.glb when credentials are set", async () => {
    const { createClient, from, upload } = mockSupabase();
    const result = await runSeed({ env, createClient, log: vi.fn() });
    expect(result.uploaded).toBe(true);
    expect(createClient).toHaveBeenCalledWith(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
    );
    expect(STORAGE_BUCKET).toBe("published");
    expect(from).toHaveBeenCalledWith(STORAGE_BUCKET);
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
    const { createClient } = mockSupabase();
    const remote = {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    };
    await expect(
      runSeed({ env: remote, createClient, log: vi.fn() }),
    ).rejects.toThrow(
      /refusing to upload.*not a local stack.*pnpm seed --force/,
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it("uploads to a non-local Supabase URL when force is set", async () => {
    const { createClient, upload } = mockSupabase();
    const remote = {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    };
    const result = await runSeed({
      env: remote,
      createClient,
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

  it("surfaces storage errors", async () => {
    const { createClient } = mockSupabase({
      error: { message: "bucket not found" },
    });
    await expect(runSeed({ env, createClient, log: vi.fn() })).rejects.toThrow(
      /published\/demo\/demo-boulder.glb failed: bucket not found/,
    );
  });
});
