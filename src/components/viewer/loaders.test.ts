import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DRACO_DECODER_PATH } from "./loaders";

describe("Draco decoder hosting (#52)", () => {
  it("is same-origin, never a third-party URL", () => {
    expect(DRACO_DECODER_PATH.startsWith("/")).toBe(true);
    expect(DRACO_DECODER_PATH).not.toMatch(/^[a-z]+:\/\//i);
  });

  it("decoder files are copied into public/ by scripts/copy-draco.mjs", () => {
    for (const f of [
      "draco_decoder.wasm",
      "draco_decoder.js",
      "draco_wasm_wrapper.js",
    ]) {
      expect(
        existsSync(join(process.cwd(), "public", DRACO_DECODER_PATH, f)),
      ).toBe(true);
    }
  });
});
