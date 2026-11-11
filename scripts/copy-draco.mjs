// Copies three's Draco decoder into public/draco/ so the viewer self-hosts it
// (no third-party requests; see #52). Runs on postinstall/predev/prebuild so the
// decoder version always matches the installed `three`. Output is gitignored.
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/three/examples/jsm/libs/draco/gltf");
const dest = join(root, "public/draco");

if (!existsSync(src)) {
  console.error(`copy-draco: decoder not found at ${src}`);
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("copy-draco: copied Draco decoder to public/draco/");
