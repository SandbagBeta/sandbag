import type { SupabaseClient } from "@supabase/supabase-js";
import { HANDLE_PATTERN } from "./handle";
import { changeHandle, ensureProfile } from "./profile";

type Res = {
  data?: unknown;
  error: { code?: string; message?: string } | null;
};

/**
 * Minimal fake of the PostgREST builder chains profile.ts uses. Each call
 * kind pops the next scripted result; calls are recorded for assertions.
 */
function fakeClient(script: {
  lookup?: Res[];
  insert?: Res[];
  update?: Res[];
}) {
  const calls = {
    inserts: [] as unknown[],
    updates: [] as unknown[],
    eqs: [] as unknown[],
  };
  const pop = (k: keyof typeof script): Res => {
    const r = script[k]?.shift();
    if (!r) throw new Error(`unexpected ${k}`);
    return r;
  };
  const client = {
    from(table: string) {
      expect(table).toBe("profiles");
      return {
        select: () => ({
          eq: (col: string, val: unknown) => {
            calls.eqs.push([col, val]);
            return { maybeSingle: async () => pop("lookup") };
          },
        }),
        insert: async (row: unknown) => {
          calls.inserts.push(row);
          return pop("insert");
        },
        update: (row: unknown) => {
          calls.updates.push(row);
          return {
            eq: (col: string, val: unknown) => {
              calls.eqs.push([col, val]);
              return { select: async () => pop("update") };
            },
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const github = {
  id: "u1",
  email: "secret.person@example.com",
  user_metadata: { user_name: "Octo-Cat", email: "secret.person@example.com" },
};
const handleTaken = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "profiles_handle_key"',
};
const none: Res = { data: null, error: null };
const ok: Res = { data: null, error: null };

describe("ensureProfile", () => {
  it("skips creation when a profile row already exists", async () => {
    const { client, calls } = fakeClient({
      lookup: [{ data: { handle: "existing" }, error: null }],
    });
    expect(await ensureProfile(client, github)).toEqual({
      status: "exists",
      handle: "existing",
    });
    expect(calls.inserts).toEqual([]);
    expect(calls.eqs).toEqual([["id", "u1"]]);
  });

  it("creates the normalized provider handle with only id + handle", async () => {
    const { client, calls } = fakeClient({ lookup: [none], insert: [ok] });
    expect(await ensureProfile(client, github)).toEqual({
      status: "created",
      handle: "octo_cat",
    });
    expect(calls.inserts).toEqual([{ id: "u1", handle: "octo_cat" }]);
    // Email never reaches the profiles table.
    expect(JSON.stringify(calls.inserts)).not.toMatch(/secret|example\.com/);
  });

  it("retries with a numeric suffix on unique violation (23505)", async () => {
    const { client, calls } = fakeClient({
      lookup: [none],
      insert: [{ error: handleTaken }, { error: handleTaken }, ok],
    });
    const rolls = [0, 0.5];
    const result = await ensureProfile(client, github, {
      random: () => rolls.shift() ?? 0,
    });
    expect(result).toEqual({ status: "created", handle: "octo_cat_5500" });
    expect(calls.inserts).toEqual([
      { id: "u1", handle: "octo_cat" },
      { id: "u1", handle: "octo_cat_1000" },
      { id: "u1", handle: "octo_cat_5500" },
    ]);
    for (const row of calls.inserts as { handle: string }[])
      expect(row.handle).toMatch(HANDLE_PATTERN);
  });

  it("gives up after maxAttempts collisions", async () => {
    const { client, calls } = fakeClient({
      lookup: [none],
      insert: Array.from({ length: 3 }, () => ({ error: handleTaken })),
    });
    const r = await ensureProfile(client, github, { maxAttempts: 3 });
    expect(r).toEqual({
      status: "error",
      error: "no free handle after retries",
    });
    expect(calls.inserts).toHaveLength(3);
  });

  it("treats a primary-key conflict as a concurrent create and re-reads", async () => {
    const { client } = fakeClient({
      lookup: [none, { data: { handle: "octo_cat" }, error: null }],
      insert: [
        {
          error: {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "profiles_pkey"',
          },
        },
      ],
    });
    expect(await ensureProfile(client, github)).toEqual({
      status: "exists",
      handle: "octo_cat",
    });
  });

  it("stops on non-unique errors (e.g. RLS denial) without retrying", async () => {
    const { client, calls } = fakeClient({
      lookup: [none],
      insert: [{ error: { code: "42501", message: "row-level security" } }],
    });
    expect(await ensureProfile(client, github)).toEqual({
      status: "error",
      error: "profile insert failed (42501)",
    });
    expect(calls.inserts).toHaveLength(1);
  });

  it("reports lookup failures", async () => {
    const { client } = fakeClient({
      lookup: [{ error: { code: "PGRST000" } }],
    });
    expect((await ensureProfile(client, github)).status).toBe("error");
  });

  it("falls back to a valid handle when the provider gives nothing usable", async () => {
    const { client, calls } = fakeClient({ lookup: [none], insert: [ok] });
    await ensureProfile(client, {
      id: "u2",
      email: undefined,
      user_metadata: {},
    });
    expect(calls.inserts).toEqual([{ id: "u2", handle: "climber" }]);
  });
});

describe("changeHandle", () => {
  it("rejects invalid input without touching the DB", async () => {
    const { client, calls } = fakeClient({});
    const r = await changeHandle(client, "u1", "no spaces");
    expect(r.ok).toBe(false);
    expect(calls.updates).toEqual([]);
  });

  it("updates only the handle on the user's own row", async () => {
    const { client, calls } = fakeClient({
      update: [{ data: [{ handle: "new_name" }], error: null }],
    });
    const r = await changeHandle(client, "u1", " New_Name ");
    expect(r).toMatchObject({ ok: true, handle: "new_name" });
    expect(calls.updates).toEqual([{ handle: "new_name" }]);
    expect(calls.eqs).toEqual([["id", "u1"]]);
  });

  it("explains a taken handle", async () => {
    const { client } = fakeClient({ update: [{ error: handleTaken }] });
    const r = await changeHandle(client, "u1", "octocat");
    expect(r).toEqual({
      ok: false,
      error: '"octocat" is taken. Try another handle.',
    });
  });

  it("maps check violations and generic errors to friendly messages", async () => {
    const check = fakeClient({ update: [{ error: { code: "23514" } }] });
    expect(await changeHandle(check.client, "u1", "abc")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/3-32/),
    });
    const other = fakeClient({ update: [{ error: { code: "XX000" } }] });
    expect(await changeHandle(other.client, "u1", "abc")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Could not save/),
    });
  });

  it("reports a missing profile when no row was updated", async () => {
    const { client } = fakeClient({ update: [{ data: [], error: null }] });
    expect(await changeHandle(client, "u1", "abc")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/No profile/),
    });
  });
});
