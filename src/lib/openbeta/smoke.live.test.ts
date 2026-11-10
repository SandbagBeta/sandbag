// @vitest-environment node
/**
 * OPT-IN live smoke test: `pnpm openbeta:smoke`. Skipped unless
 * OPENBETA_SMOKE=1, so CI never touches the network. Fetches the two ADR test
 * areas from api.openbeta.io (2 requests, through the 1 req/s throttle), runs
 * the real parse -> cache-write path into an in-memory database, and prints
 * names, ancestor counts and climb counts. Never prints coordinates.
 *
 * Runs under vitest so `import "server-only"` can be mocked; plain Node would
 * need `--conditions=react-server` plus a TS loader.
 */
import { describe, expect, it, vi } from "vitest";
import { getArea } from "./cache";
import { createFakeDb } from "./fake-db";
import { HAMMOND_POND, PAWTUCKAWAY } from "./__fixtures__";

vi.mock("server-only", () => ({}));

describe.runIf(process.env.OPENBETA_SMOKE === "1")(
  "OpenBeta live smoke",
  () => {
    it(
      "fetches and caches the two test areas",
      { timeout: 60_000 },
      async () => {
        const db = createFakeDb();
        for (const id of [PAWTUCKAWAY, HAMMOND_POND]) {
          const res = await getArea(id, { client: db.client, defer: () => {} });
          expect(res.status).toBe("ok");
          if (res.status !== "ok") continue;
          const { area, climbs } = res.data;
          const childClimbs = (db.tables.climb_cache ?? []).length;
          console.info(
            `${area.path_tokens.join(" > ")}\n` +
              `  ancestors: ${area.ancestors.length}, total climbs: ${area.total_climbs}, ` +
              `own climbs: ${climbs.length}, climbs cached so far: ${childClimbs}, ` +
              `organizations: ${area.organizations.length}`,
          );
        }
      },
    );
  },
);
