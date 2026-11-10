import { describe, expect, it } from "vitest";
import {
  resolveEffectivePrivacy,
  type AreaChainRow,
  type PrivacyChain,
  type PrivacyRow,
} from "./privacy";

const ROOT = "00000000-0000-4000-8000-000000000001";
const MID = "00000000-0000-4000-8000-000000000002";
const LEAF = "00000000-0000-4000-8000-000000000003";

const row = (id: string, extra: Partial<AreaChainRow> = {}): AreaChainRow => ({
  openbeta_area_id: id,
  ancestors_changed_at: null,
  ...extra,
});

/** A consistent ROOT > MID > LEAF chain, asking about LEAF. */
function chain(over: Partial<PrivacyChain> = {}): PrivacyChain {
  return {
    areaId: LEAF,
    area: row(LEAF, { ancestors: [ROOT, MID], path_tokens: ["US", "NH", "B"] }),
    ancestorRows: [row(ROOT), row(MID)],
    privacyRows: [],
    ...over,
  };
}

const flag = (id: string, location_privacy: unknown): PrivacyRow => ({
  openbeta_area_id: id,
  location_privacy,
});

describe("resolveEffectivePrivacy: fail closed (P1)", () => {
  it("uncached area is hidden", () => {
    expect(resolveEffectivePrivacy(chain({ area: null }))).toEqual({
      privacy: "hidden",
      cause: "uncached",
    });
  });

  it("a cache row for a different id is hidden", () => {
    expect(resolveEffectivePrivacy(chain({ areaId: MID })).privacy).toBe(
      "hidden",
    );
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["not an array", "ROOT,MID"],
    ["non-string entries", [ROOT, 7]],
    ["empty-string entries", [ROOT, ""]],
  ])("ancestors %s is hidden", (_, ancestors) => {
    const c = chain({
      area: row(LEAF, { ancestors, path_tokens: ["a", "b", "c"] }),
    });
    expect(resolveEffectivePrivacy(c)).toEqual({
      privacy: "hidden",
      cause: "bad_ancestors",
    });
  });

  it("path_tokens inconsistent with ancestors is hidden", () => {
    for (const path_tokens of [
      undefined,
      ["US", "B"],
      ["US", "NH", "X", "B"],
    ]) {
      const c = chain({
        area: row(LEAF, { ancestors: [ROOT, MID], path_tokens }),
      });
      expect(resolveEffectivePrivacy(c).privacy).toBe("hidden");
    }
  });

  it("an ancestor missing from the cache is hidden", () => {
    for (const ancestorRows of [[row(ROOT)], [row(MID)], []]) {
      expect(resolveEffectivePrivacy(chain({ ancestorRows }))).toEqual({
        privacy: "hidden",
        cause: "ancestor_uncached",
      });
    }
  });

  it("an unrecognised stored privacy value is hidden", () => {
    const c = chain({ privacyRows: [flag(MID, "public"), flag(LEAF, null)] });
    expect(resolveEffectivePrivacy(c).privacy).toBe("hidden");
  });
});

describe("resolveEffectivePrivacy: re-parenting (P3)", () => {
  const at = "2026-11-10T00:00:00Z";
  it("ancestors_changed_at on the area itself hides it", () => {
    const c = chain({
      area: row(LEAF, {
        ancestors: [ROOT, MID],
        path_tokens: ["US", "NH", "B"],
        ancestors_changed_at: at,
      }),
    });
    expect(resolveEffectivePrivacy(c)).toEqual({
      privacy: "hidden",
      cause: "reparented",
    });
  });

  it.each([ROOT, MID])("ancestors_changed_at on ancestor %s hides it", (id) => {
    const ancestorRows = [ROOT, MID].map((a) =>
      row(a, { ancestors_changed_at: a === id ? at : null }),
    );
    expect(resolveEffectivePrivacy(chain({ ancestorRows })).privacy).toBe(
      "hidden",
    );
  });

  it("re-parenting beats an explicit exact row", () => {
    const c = chain({
      ancestorRows: [row(ROOT), row(MID, { ancestors_changed_at: at })],
      privacyRows: [flag(LEAF, "exact")],
    });
    expect(resolveEffectivePrivacy(c).privacy).toBe("hidden");
  });
});

describe("resolveEffectivePrivacy: default and inheritance (P2, P4)", () => {
  it("no flag anywhere after a full lookup is exact", () => {
    expect(resolveEffectivePrivacy(chain())).toEqual({ privacy: "exact" });
  });

  it("a root area (no ancestors) can be exact", () => {
    const c = chain({
      areaId: ROOT,
      area: row(ROOT, { ancestors: [], path_tokens: ["US"] }),
      ancestorRows: [],
    });
    expect(resolveEffectivePrivacy(c)).toEqual({ privacy: "exact" });
  });

  it("a hidden root hides every descendant", () => {
    expect(
      resolveEffectivePrivacy(chain({ privacyRows: [flag(ROOT, "hidden")] })),
    ).toEqual({ privacy: "hidden", cause: "flagged" });
  });

  it("flags on areas outside the chain are ignored", () => {
    const other = "00000000-0000-4000-8000-000000000009";
    const c = chain({ privacyRows: [flag(other, "hidden")] });
    expect(resolveEffectivePrivacy(c).privacy).toBe("exact");
  });

  // Exhaustive: every combination of (no row / exact / fuzzed / hidden) on
  // root, mid and leaf. The most restrictive value must win.
  const values = [null, "exact", "fuzzed_1km", "hidden"] as const;
  const rank = { exact: 0, fuzzed_1km: 1, hidden: 2 } as const;
  const cases = values.flatMap((r) =>
    values.flatMap((m) => values.map((l) => [r, m, l] as const)),
  );
  it.each(cases)("root=%s mid=%s leaf=%s: most restrictive wins", (r, m, l) => {
    const set = [
      [ROOT, r],
      [MID, m],
      [LEAF, l],
    ] as const;
    const privacyRows = set.filter(([, v]) => v).map(([id, v]) => flag(id, v));
    const result = resolveEffectivePrivacy(chain({ privacyRows }));
    const present = set.map(([, v]) => v).filter((v) => v !== null);
    const expected = present.reduce<keyof typeof rank>(
      (w, v) => (rank[v] > rank[w] ? v : w),
      "exact",
    );
    expect(result.privacy).toBe(expected);
    if (result.privacy === "fuzzed_1km") {
      // The anchor is the root-most fuzzed area in the chain.
      expect(result.anchorId).toBe(set.find(([, v]) => v === "fuzzed_1km")![0]);
    }
  });
});
