import { describe, expect, it, vi } from "vitest";
import { MeshUnavailableError } from "./loadSurface";
import type { FailureLogEntry } from "./failureLog";
import {
  mapRpcError,
  rejectPayload,
  saveClimbAnnotations,
  type SaveDeps,
} from "./save";
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
  const log = vi.fn<(entry: FailureLogEntry) => Promise<boolean>>(
    async () => true,
  );
  const d: SaveDeps = {
    loadScan: async () => publishedScan,
    listClimbs: async () => [{ id: "other", name: "Other" }],
    loadClimb: async () => ownPending,
    loadSurface: async () => mesh,
    rpc: rpc as unknown as SaveDeps["rpc"],
    logFailure: log,
    ...over,
  };
  return { d, rpc, log };
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

  it("clears the sequence number of a foot hold instead of failing the save", () => {
    const r = parseSaveClimbInput(
      payload({
        holds: [
          hold("a", 1, "start", 0),
          hold("b", 2, "hand", 1),
          hold("c", 3, "finish", 2),
          hold("f", 4, "foot", 3),
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.holds.find((h) => h.id === "f")!.seq_order).toBeNull();
      expect(r.input.holds.find((h) => h.id === "c")!.seq_order).toBe(2);
    }
  });

  it("closes the gaps that feet leave in the sequence, keeping the order", () => {
    // Old editor: start 0, foot 1, hand 2, foot 3, finish 4.
    const r = parseSaveClimbInput(
      payload({
        holds: [
          hold("s", 1, "start", 0),
          hold("f1", 2, "foot", 1),
          hold("h", 3, "hand", 2),
          hold("f2", 4, "foot", 3),
          hold("e", 5, "finish", 4),
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const seq = Object.fromEntries(
        r.input.holds.map((h) => [h.id, h.seq_order]),
      );
      expect(seq).toEqual({ s: 0, f1: null, h: 1, f2: null, e: 2 });
    }
  });

  it("leaves duplicate sequence numbers for the validator to report", () => {
    const r = parseSaveClimbInput(
      payload({
        holds: [
          hold("a", 1, "start", 0),
          hold("b", 2, "hand", 0),
          hold("c", 3, "finish", 2),
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.holds.map((h) => h.seq_order)).toEqual([0, 0, 2]);
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

  it("saves foot holds as unordered single points that don't count toward 3", async () => {
    const { d, rpc } = deps();
    const r = await saveClimbAnnotations(
      d,
      USER,
      parse({
        holds: [
          hold("a", 1, "start", 0),
          hold("b", 2, "hand", 1),
          hold("c", 3, "finish", 2),
          hold("f1", 4, "foot"),
          hold("f2", 5, "foot"),
        ],
      }),
    );
    expect(r.ok).toBe(true);
    const args = (
      rpc.mock.calls[0] as unknown as [
        string,
        { p_holds: { type: string; seq_order: number | null }[] },
      ]
    )[1];
    const feet = args.p_holds.filter((h) => h.type === "foot");
    expect(feet).toHaveLength(2);
    expect(feet.every((h) => h.seq_order === null)).toBe(true);

    const tooFew = await saveClimbAnnotations(
      d,
      USER,
      parse({
        holds: [
          hold("a", 1, "start", 0),
          hold("b", 2, "hand", 1),
          hold("f1", 4, "foot"),
          hold("f2", 5, "foot"),
        ],
      }),
    );
    expect(tooFew).toMatchObject({ ok: false, code: "validation" });
    if (!tooFew.ok && tooFew.code === "validation") {
      expect(tooFew.issues.map((i) => i.code)).toEqual(["too_few_holds"]);
    }
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

describe("failure help and the private log", () => {
  const entryOf = (log: { mock: { calls: unknown[][] } }) =>
    log.mock.calls[0]![0] as FailureLogEntry;

  it("explains a failure the user can fix, and logs nothing", async () => {
    const { d, log } = deps();
    const r = await saveClimbAnnotations(
      d,
      USER,
      parse({ holds: [hold("a", 1, "start", 0), hold("b", 2)] }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.help).toMatchObject({
      stage: "validation",
      stageLabel: "Checking your holds and lines",
      userFixable: true,
    });
    expect(r.help.whatYouCanDo.join(" ")).toMatch(/foot holds don't count/);
    expect(r.help.nextSteps.length).toBeGreaterThan(0);
    expect(r.help.reference).toBeUndefined();
    expect(r.help.reportPath).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("treats a changed mesh as the user's to fix: reload and re-place", async () => {
    const { d, log } = deps({
      loadScan: async () => ({
        ...publishedScan,
        content_hash: "b".repeat(64),
      }),
    });
    const r = await saveClimbAnnotations(d, USER, parse());
    expect(r).toMatchObject({ ok: false, code: "stale" });
    if (!r.ok) {
      expect(r.help).toMatchObject({ stage: "scan", userFixable: true });
      expect(r.help.whatYouCanDo.join(" ")).toMatch(/Reload/);
    }
    expect(log).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<SaveDeps>, string, string]>([
    [
      "the scan isn't available",
      { loadScan: async () => null },
      "not_found",
      "scan",
    ],
    [
      "someone else's climb",
      { loadClimb: async () => ({ ...ownPending, created_by: "x" }) },
      "forbidden",
      "access",
    ],
    [
      "the mesh can't be loaded",
      {
        loadSurface: async () => {
          throw new Error("storage said: bucket secret-name denied");
        },
      },
      "mesh_unavailable",
      "mesh",
    ],
    [
      "the database fails on a lookup",
      {
        loadScan: async () => {
          throw new Error("loading scan: connection refused 10.0.0.5");
        },
      },
      "error",
      "database",
    ],
    [
      "the save call fails",
      {
        rpc: async () => ({
          data: null,
          error: { code: "XX000", message: "relation internal_table missing" },
        }),
      },
      "error",
      "database",
    ],
  ])(
    "logs a failure the user can't fix (%s) and gives a reference and link",
    async (_label, over, code, stage) => {
      const { d, log } = deps(over);
      const input = parse({ climbId: code === "forbidden" ? CLIMB : null });
      const r = await saveClimbAnnotations(d, USER, input);
      expect(r).toMatchObject({ ok: false, code });
      if (r.ok) return;
      expect(r.help).toMatchObject({ stage, userFixable: false });
      const ref = r.help.reference!;
      expect(ref).toMatch(/^SB-[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(r.help.reportPath).toContain(ref);
      expect(r.help.nextSteps.join(" ")).toContain(ref);
      expect(r.help.whatHappened).toMatch(/wasn't saved/);
      expect(log).toHaveBeenCalledTimes(1);
      expect(entryOf(log)).toMatchObject({
        reference: ref,
        stage,
        code,
        userId: USER,
        scanId: SCAN,
      });
      // What the user sees never contains the provider's or the database's text.
      const shown = JSON.stringify(r);
      expect(shown).not.toMatch(/secret-name|10.0.0.5|internal_table/);
    },
  );

  it("logs counts only: no positions, names or file contents", async () => {
    const { d, log } = deps({
      rpc: async () => ({
        data: null,
        error: { code: "XX000", message: "boom" },
      }),
    });
    await saveClimbAnnotations(
      d,
      USER,
      parse({
        holds: [
          hold("a", 1, "start", 0),
          hold("b", 2, "hand", 1),
          hold("c", 3, "finish", 2),
          hold("f", 4, "foot"),
        ],
      }),
    );
    const entry = entryOf(log);
    expect(entry.context).toEqual({
      mode: "create",
      holds: 3,
      feet: 1,
      paths: 1,
    });
    const text = JSON.stringify(entry);
    expect(text).not.toMatch(/position|normal|The Slab/);
  });

  it("gives no reference when the log write fails, rather than one nobody can find", async () => {
    const { d } = deps({
      loadSurface: async () => {
        throw new Error("x");
      },
      logFailure: async () => false,
    });
    const r = await saveClimbAnnotations(d, USER, parse());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.help.reference).toBeUndefined();
    expect(r.help.reportPath).toBeUndefined();
    expect(r.help.nextSteps.length).toBeGreaterThan(0);
  });

  it("a database lookup that fails is an error, not a fake 'not found'", async () => {
    const { d } = deps({
      loadScan: async () => {
        throw new Error("timeout");
      },
    });
    const r = await saveClimbAnnotations(d, USER, parse());
    expect(r).toMatchObject({ ok: false, code: "error" });
  });

  describe("payload problems", () => {
    const issueFor = (over: Record<string, unknown>) => {
      const p = parseSaveClimbInput(payload(over));
      if (p.ok) throw new Error("expected a payload problem");
      return p.issues;
    };

    it("a name that is too long is the user's to fix and isn't logged", async () => {
      const { d, log } = deps();
      const r = await rejectPayload(
        d,
        USER,
        issueFor({ name: "x".repeat(200) }),
      );
      expect(r.help).toMatchObject({ stage: "payload", userFixable: true });
      expect(r.help.whatYouCanDo.join(" ")).toMatch(/highlighted field/);
      expect(log).not.toHaveBeenCalled();
    });

    it("a broken hold is the app's fault: logged with a reference", async () => {
      const { d, log } = deps();
      const r = await rejectPayload(
        d,
        USER,
        issueFor({ holds: [{ ...hold("a", 1), position: [NaN, 0, 0] }] }),
      );
      expect(r.help).toMatchObject({ stage: "payload", userFixable: false });
      expect(r.help.reference).toMatch(/^SB-/);
      expect(log).toHaveBeenCalledTimes(1);
    });
  });
});
