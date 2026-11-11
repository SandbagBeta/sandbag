import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import noRawCoordinates from "./eslint-rules/no-raw-coordinates.mjs";

const sandbag = { rules: { "no-raw-coordinates": noRawCoordinates } };

export default defineConfig([
  globalIgnores([
    ".next/**",
    "out/**",
    "coverage/**",
    "next-env.d.ts",
    "public/draco/**", // vendored decoder copied from three
    ".claude/worktrees/**",
  ]),
  ...nextVitals,
  ...nextTs,
  prettier,
  // Access privacy (CLAUDE.md value 1): coordinates only via the formatter.
  {
    plugins: { sandbag },
    rules: { "sandbag/no-raw-coordinates": "error" },
  },
  {
    files: [
      "src/lib/location.ts",
      "src/lib/location.test.ts",
      "src/lib/location/**",
      "eslint-rules/**",
    ],
    rules: { "sandbag/no-raw-coordinates": "off" },
  },
]);
