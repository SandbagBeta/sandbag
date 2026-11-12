// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// A decoder wasm that can't load is our fault, not the contributor's (#119).
vi.mock("draco3dgltf", () => ({
  default: {
    createDecoderModule: () => Promise.reject(new Error("ENOENT: wasm")),
  },
}));

describe("decoder init failure", () => {
  it("rejects (infrastructure error) instead of a 'damaged file' parse verdict", async () => {
    const { runQcChecks } = await import("./run");
    const bytes = new Uint8Array(readFileSync("fixtures/qc/good-draco.glb"));
    await expect(runQcChecks({ bytes, kind: "glb" })).rejects.toThrow(
      "decoder failed to initialise",
    );
  });

  it("still gives a parse verdict for a genuinely corrupt file", async () => {
    const { runQcChecks } = await import("./run");
    const bytes = new Uint8Array(readFileSync("fixtures/qc/bad-truncated.glb"));
    const r = await runQcChecks({ bytes, kind: "glb" });
    expect(r.report.checks.find((c) => c.id === "parse")?.pass).toBe(false);
  });
});
