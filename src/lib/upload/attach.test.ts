import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ searchAreas: vi.fn(), getArea: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../openbeta", () => m);

import { listAttachClimbs, searchAttachAreas, toAttachArea } from "./attach";

const hit = {
  id: "a",
  name: "Boulder Field",
  pathTokens: ["USA", "New Hampshire", "Pawtuckaway", "Boulder Field"],
  totalClimbs: 12,
  isLeaf: false,
};

describe("attach lookups", () => {
  it("shows ancestors as context and exposes no coordinates", () => {
    const a = toAttachArea(hit);
    expect(a.path).toBe("USA › New Hampshire › Pawtuckaway");
    expect(Object.keys(a).sort()).toEqual(["climbCount", "id", "name", "path"]);
  });

  it("caps results at 10 and passes through incompleteness", async () => {
    m.searchAreas.mockResolvedValue({
      hits: Array.from({ length: 15 }, () => hit),
      source: "cache",
      incomplete: true,
    });
    const res = await searchAttachAreas("paw");
    expect(res).toMatchObject({ ok: true, incomplete: true });
    expect(res.ok && res.items).toHaveLength(10);
  });

  it("lists climbs sorted with a V grade, and fails soft when unavailable", async () => {
    m.getArea.mockResolvedValue({
      status: "ok",
      stale: false,
      data: {
        climbs: [
          { openbeta_climb_id: "2", name: "Zed", grades: { vscale: "V3" } },
          { openbeta_climb_id: "1", name: "Alpha", grades: {} },
        ],
      },
    });
    const res = await listAttachClimbs("x");
    expect(res.ok && res.items.map((c) => [c.name, c.grade])).toEqual([
      ["Alpha", null],
      ["Zed", "V3"],
    ]);
    m.getArea.mockResolvedValue({ status: "unavailable", reason: "not_found" });
    expect((await listAttachClimbs("x")).ok).toBe(false);
  });
});
