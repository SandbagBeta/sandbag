#!/usr/bin/env node
// Opt-in live check of the OpenBeta client (#27). Not run in CI.
// Sets OPENBETA_SMOKE=1 and runs src/lib/openbeta/smoke.live.test.ts, which
// makes 2 requests to api.openbeta.io and prints no coordinates.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const vitest = join(
  dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);
const { status } = spawnSync(
  process.execPath,
  [vitest, "run", "src/lib/openbeta/smoke.live.test.ts", "--silent=false"],
  { stdio: "inherit", env: { ...process.env, OPENBETA_SMOKE: "1" } },
);
process.exit(status ?? 1);
