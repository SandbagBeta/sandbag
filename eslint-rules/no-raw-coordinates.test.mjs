// @vitest-environment node
import { RuleTester } from "eslint";
import rule from "./no-raw-coordinates.mjs";

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2024,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run("no-raw-coordinates", rule, {
  valid: [
    // 3D viewer code must not trip the rule.
    "mesh.position.set(0, 1, 0); const hit = event.point;",
    "const { geometry, coords } = mesh;",
    "camera.lookAt(target.x, target.y, target.z);",
    // Names that merely contain a geo word.
    "const plateau = 1; obj.latency = 2; const translate = 3;",
    'const label = "Boulder name";',
    // Module specifiers are not data.
    'import { formatLocation } from "./bbox-utils";',
    // Computed access with a variable key can't be resolved statically.
    "row[key] = 1;",
  ],
  invalid: [
    { code: "const y = area.metadata.lat;", errors: [{ messageId: "key" }] },
    { code: 'const b = row["bbox"];', errors: [{ messageId: "key" }] },
    { code: "const { lat, lng } = meta;", errors: 2 },
    { code: "send({ latitude: 1, longitude: 2 });", errors: 2 },
    { code: 'const o = { "lng": 1 };', errors: [{ messageId: "key" }] },
    { code: "const g = { coordinates: [] };", errors: [{ messageId: "key" }] },
    { code: "const p = <Pin lat={a} lng={b} />;", errors: 2 },
    {
      code: "const q = `query { area { metadata { lat lng } } }`;",
      errors: [{ messageId: "text" }],
    },
    {
      code: 'const q = "query { cragsNear(lnglat: $p) { uuid } }";',
      errors: [{ messageId: "text" }],
    },
    {
      code: 'supabase.from("area_cache_coords").select("*");',
      errors: [{ messageId: "text" }],
    },
  ],
});
