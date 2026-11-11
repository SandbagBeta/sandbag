import { createHash } from "node:crypto";
import type { Climb, ClimbPath, Hold, Scan } from "@/lib/types";
import { createZip, readZip } from "./zip";

/** Bump on any breaking change to the JSON layout; documented in docs/export-format.md. */
export const EXPORT_SCHEMA_VERSION = 1;

export interface Contributor {
  handle: string;
  role: "scan" | "climb";
}

export interface BoulderExportInput {
  scan: Pick<
    Scan,
    | "id"
    | "openbeta_area_id"
    | "openbeta_climb_id"
    | "content_hash"
    | "tri_count"
    | "texture_res"
    | "capture_app"
    | "captured_at"
    | "license"
  >;
  climbs: Climb[];
  holds: Hold[];
  paths: ClimbPath[];
  contributors: Contributor[];
  glb: Uint8Array;
  exportedAt: string;
}

const LICENSE_TEXT = `This data is licensed under Creative Commons Attribution-ShareAlike 4.0
International (CC BY-SA 4.0): https://creativecommons.org/licenses/by-sa/4.0/legalcode

You must credit the contributors listed in ATTRIBUTION.txt and license any
derivatives under CC BY-SA 4.0. Climbing metadata remains under OpenBeta's terms.
`;

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const json = (v: unknown) =>
  new TextEncoder().encode(JSON.stringify(v, null, 2) + "\n");

/**
 * Builds the open-data zip for one published scan. Mesh-local geometry only:
 * no geographic fields exist on these shapes, so nothing here can leak
 * coordinates (location privacy, PRD §2).
 */
export function buildBoulderExport(input: BoulderExportInput): Uint8Array {
  const { scan, glb } = input;
  if (!scan.content_hash || sha256(glb) !== scan.content_hash) {
    throw new Error("GLB bytes do not match scan content_hash");
  }
  const handles = [...new Set(input.contributors.map((c) => c.handle))].sort();
  const manifest = {
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: input.exportedAt,
    license: scan.license,
    scan: { ...scan, glb_file: "mesh.glb" },
  };
  return createZip([
    { name: "manifest.json", data: json(manifest) },
    { name: "mesh.glb", data: glb },
    { name: "climbs.json", data: json(input.climbs) },
    { name: "holds.json", data: json(input.holds) },
    { name: "paths.json", data: json(input.paths) },
    {
      name: "grades.json",
      data: json(
        input.climbs.map((c) => ({
          climb_id: c.id,
          proposed_grade: c.proposed_grade,
        })),
      ),
    },
    { name: "LICENSE.txt", data: new TextEncoder().encode(LICENSE_TEXT) },
    {
      name: "ATTRIBUTION.txt",
      data: new TextEncoder().encode(
        `Contributors (CC BY-SA 4.0):\n${handles.map((h) => `- ${h}`).join("\n")}\n`,
      ),
    },
  ]);
}

export interface ParsedBoulderExport {
  manifest: { schema_version: number; scan: BoulderExportInput["scan"] };
  climbs: Climb[];
  holds: Hold[];
  paths: ClimbPath[];
  glb: Uint8Array;
}

/** Validates and reads an export zip (the import side of the round trip). */
export function parseBoulderExport(zip: Uint8Array): ParsedBoulderExport {
  const files = new Map(readZip(zip).map((e) => [e.name, e.data]));
  const get = (n: string) => {
    const f = files.get(n);
    if (!f) throw new Error(`missing ${n}`);
    return f;
  };
  const read = <T>(n: string) =>
    JSON.parse(new TextDecoder().decode(get(n))) as T;
  const manifest = read<ParsedBoulderExport["manifest"]>("manifest.json");
  if (manifest.schema_version !== EXPORT_SCHEMA_VERSION) {
    throw new Error(`unsupported schema_version ${manifest.schema_version}`);
  }
  const glb = get("mesh.glb");
  if (sha256(glb) !== manifest.scan.content_hash)
    throw new Error("GLB hash mismatch");
  const holds = read<Hold[]>("holds.json");
  if (holds.some((h) => h.scan_content_hash !== manifest.scan.content_hash)) {
    throw new Error("hold anchored to a different mesh");
  }
  return {
    manifest,
    climbs: read<Climb[]>("climbs.json"),
    holds,
    paths: read<ClimbPath[]>("paths.json"),
    glb,
  };
}
