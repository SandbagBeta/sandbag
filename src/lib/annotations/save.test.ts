import { describe, expect, it, vi } from "vitest";
import { MeshUnavailableError } from "./loadSurface";
import { mapRpcError, saveClimbAnnotations, type SaveDeps } from "./save";
import { parseSaveClimbInput, type SaveClimbInput } from "./saveInput";

vi.mock("server-only", () => ({}));

const HASH = "a".repeat(64);
const SCAN = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const CLIMB = "33333333-3333-4333-8333-333333333333";

// One big triangle in the z=0 plane; every hold below lies on face 0.
const mesh = {
  positions: [0, 0, 0, 10, 0, 0, 0, 10, 0],
  indices: [0, 1, 2],
};

const hold = (
  id: string,
  x: number,
  type = "hand",
  seq: number | null = null,
) => ({
  id,
  position: [x, 1, 0],
  normal: [0, 0, 1],
  face_index: 0,
  type,
  seq_order: seq,
});

const payload = (over: Record<string, unknown> = {}) => ({
  scanId: SCAN,
  climbId: null,
  scanContentHash: HASH,
  name: "The Slab",
  description: "",
  proposedGrade: "v3",
  faInfo: null,
  holds: [
    hold("a", 1, "start", 0),
    hold("b", 2, "hand", 1),
    hold("c", 3, "finish", 2),
  ],
  paths: [
    {
      kind: "line",
      points: [
        [1, 1, 0],
        [3, 1, 0],
      ],
    },
  ],
  ...over,
});

const parse = (over?: Record<string, unknown>): SaveClimbInput => {
  const r = parseSaveClimbInput(payload(over));
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.input;
};

const publishedScan = {
  id: SCAN,
  status: "published",
  content_hash: HASH,
  glb_path: "p/x.glb",
};
const ownPending = {
  id: CLIMB,
  scan_id: SCAN,
  name: "The Slab",
  created_by: USER,
  status: "pending_review",
};

function deps(over: Partial<SaveDeps> = {}) {
  const rpc = vi.fn(async (fn: string) => ({
    data: fn === "create_climb_annotations" ? CLIMB : null,
    error: null,
  }));
  const d: SaveDeps = {
    loadScan: async () => publishedScan,
    listClimbs: async () => [{ id: "other", name: "Other" }],
    loadClimb: async () => ownPending,
    loadSurface: async () => mesh,
    rpc: rpc as unknown as SaveDeps["rpc"],
    ...over,
  };
  return { d, rpc };
}

describe("parseSaveClimbInput", () => {
  it("keeps only known fields and normalises the grade", () => {
    const r = parseSaveClimbInput({
      ...payload(),
      evil: 1,
      holds: [
        { ...hold("a", 1, "start", 0), extra: "x" },
        hold("b", 2),
        hold("c", 3),
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.proposedGrade).toBe("V3");
      expect(Object.keys(r.input.holds[0]!)).toEqual([
        "id",
        "position",
        "normal",
        "face_index",
        "type",
        "seq_order",
      ]);
    }
  });

  const twoLines = [
    {
      kind: "line",
      points: [
        [0, 0, 0],
        [1, 1, 1],
      ],
    },
    {
      kind: "line",
      points: [
        [0, 0, 0],
        [1, 1, 1],
      ],
    },
  ];
  it.each([
    ["non-object body", "nope"],
    ["bad scan id", payload({ scanId: "x" })],
    ["bad hash", payload({ scanContentHash: "ABC" })],
    ["bad grade", payload({ proposedGrade: "5.12a" })],
    [
      "non-finite position",
      payload({ holds: [{ ...hold("a", 1), position: [NaN, 0, 0] }] }),
    ],
    [
      "non-unit normal",
      payload({ holds: [{ ...hold("a", 1), normal: [0, 0, 5] }] }),
    ],
    ["unknown hold type", payload({ holds: [hold("a", 1, "jug")] })],
    ["two paths of one kind", payload({ paths: twoLines })],
    [
      "too many holds",
      payload({
        holds: Array.from({ length: 201 }, (_, i) => hold(`h${i}`, 1)),
      }),
    ],
  ])("rejects %s with bad_payload", (_label, body) => {
    const r = parseSaveClimbInput(body);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.every((i) => i.code === "bad_payload")).toBe(true);
    }
  });
});

describe("saveClimbAnnotations", () => {
  it("creates a climb: validates, then one RPC with the mesh hash and no hold hashes", async () => {
    const { d, rpc } = deps();
    const r = await saveClimbAnnotations(d, USER, parse());
    expect(r).toEqual({ ok: true, climbId: CLIMB });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(fn).toBe("create_climb_annotations");
    expect(args).toMatchObject({
      p_user_id: USER,
      p_scan_id: SCAN,
      p_scan_content_hash: HASH,
      p_name: "The Slab",
      p_proposed_grade: "V3",
    });
    expect(JSON.stringify(args.p_holds)).not.toContain("scan_content_hash");
  });

  it("returns validator issues and writes nothing", async () => {
    const { d, rpc } = deps();
    const r = await saveClimbAnnotations(
      d,
      USER,
      parse({ holds: [hold("a", 1, "start"), hold("b", 2)] }),
    );
    expect(r).toMatchObject({ ok: false, code: "validation" });
    if (!r.ok && r.code === "validation") {
      expect(r.issues.map((i) => i.code)).toContain("too_few_holds");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a hold off the mesh surface", async () => {
    const { d, rpc } = deps();
    const off = { ...hold("c", 3, "finish", 2), position: [3, 1, 2] };
    const r = await saveClimbAnnotations(
      d,
      USER,
      parse({
        holds: [hold("a", 1, "start", 0), hold("b", 2, "hand", 1), off],
      }),
    );
    expect(r).toMatchObject({ ok: false, code: "validation" });
    if (!r.ok && r.code === "validation") {
      expect(r.issues.map((i) => i.code)).toContain("off_surface");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("flags a duplicate name from the existing climbs", async () => {
    const { d } = deps({
      listClimbs: async () => [{ id: "o", name: "the  slab" }],
    });
    const r = await saveClimbAnnotations(d, USER, parse());
    expect(r).toMatchObject({ ok: false, code: "validation" });
  });

  it("is stale when the scan's mesh hash differs, before decoding anything", async () => {
    const loadSurface = vi.fn(async () => mesh);
    const { d } = deps({
      loadSurface,
      loadScan: async () => ({
        ...publishedScan,
        content_hash: "b".repeat(64),
      }),
    });
    expect(await saveClimbAnnotations(d, USER, parse())).toMatchObject({
      ok: false,
      code: "stale",
    });
    expect(loadSurface).not.toHaveBeenCalled();
  });

  it.each(["uploaded", "pending_review", "rejected"])(
    "treats a %s scan as not found",
    async (status) => {
      const { d } = deps({
        loadScan: async () => ({ ...publishedScan, status }),
      });
      expect(await saveClimbAnnotations(d, USER, parse())).toMatchObject({
        ok: false,
        code: "not_found",
      });
    },
  );

  it("reports mesh_unavailable when the mesh can't be loaded", async () => {
    const { d } = deps({
      loadSurface: async () => {
        throw new MeshUnavailableError("x");
      },
    });
    expect(await saveClimbAnnotations(d, USER, parse())).toMatchObject({
      ok: false,
      code: "mesh_unavailable",
    });
  });

  describe("replace", () => {
    it("replaces own pending climb, keeping its name, and excludes itself from duplicates", async () => {
      const { d, rpc } = deps({
        listClimbs: async () => [{ id: CLIMB, name: "The Slab" }],
      });
      const r = await saveClimbAnnotations(
        d,
        USER,
        parse({ climbId: CLIMB, name: "ignored" }),
      );
      expect(r).toEqual({ ok: true, climbId: CLIMB });
      expect(rpc.mock.calls[0]![0]).toBe("replace_climb_annotations");
    });

    it("refuses another user's climb and a non-pending one", async () => {
      const other = deps({
        loadClimb: async () => ({ ...ownPending, created_by: "someone-else" }),
      });
      expect(
        await saveClimbAnnotations(other.d, USER, parse({ climbId: CLIMB })),
      ).toMatchObject({ ok: false, code: "forbidden" });
      const done = deps({
        loadClimb: async () => ({ ...ownPending, status: "published" }),
      });
      expect(
        await saveClimbAnnotations(done.d, USER, parse({ climbId: CLIMB })),
      ).toMatchObject({ ok: false, code: "forbidden" });
    });

    it("refuses a climb that belongs to a different scan", async () => {
      const { d } = deps({
        loadClimb: async () => ({ ...ownPending, scan_id: "other-scan" }),
      });
      expect(
        await saveClimbAnnotations(d, USER, parse({ climbId: CLIMB })),
      ).toMatchObject({ ok: false, code: "not_found" });
    });
  });
});

describe("mapRpcError", () => {
  it.each([
    [{ code: "23505", message: "dup" }, "validation"],
    [{ code: "42501", message: "not your climb" }, "forbidden"],
    [{ code: "23514", message: "scan mesh changed (hash_mismatch)" }, "stale"],
    [
      { code: "23514", message: "scan is not published (scan_not_published)" },
      "stale",
    ],
    [
      {
        code: "23514",
        message: "only pending_review climbs can be edited (not_pending)",
      },
      "forbidden",
    ],
    [
      {
        code: "23514",
        message: "a climb needs at least 3 holds (too_few_holds)",
      },
      "error",
    ],
    [{ code: "XX000", message: "boom" }, "error"],
  ])("%j -> %s", (error, code) => {
    expect(mapRpcError(error).code).toBe(code);
  });

  it("does not leak the database message", () => {
    expect(
      mapRpcError({ code: "XX000", message: "relation secret_table" }).message,
    ).not.toMatch(/secret/);
  });
});
