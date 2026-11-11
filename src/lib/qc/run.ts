import type { Document } from "@gltf-transform/core";
import { qcPassed } from "../lifecycle/qc-report";
import type { QcCheckResult, QcReport } from "../types";
import type { UploadKind } from "../upload/validate";
import {
  checkColor,
  checkFileSize,
  checkFileType,
  checkFloaters,
  checkMeshQuality,
  checkParse,
  checkScale,
  checkTextureResolution,
  checkTooLarge,
  checkTriCount,
  checkVolume,
  checkZipTooLarge,
} from "./checks";
import { sniff } from "./detect";
import { measureMesh, type MeshStats } from "./geometry";
import {
  flattenDocument,
  gltfJsonTriangleCount,
  readGlbJson,
  readGltfDocument,
  readGltfJson,
} from "./gltf";
import { MeshParseError, type ParsedMesh } from "./mesh";
import { StageTimer, type QcMetrics } from "./metrics";
import { objFaceLineCount, parseObj } from "./obj";
import { parsePly, parsePlyHeader, plyHeaderFaceCount } from "./ply";
import { buildQcReport } from "./report";
import { MAX_RAW_BYTES, ZIP_INFLATED_BYTES_LIMIT } from "./thresholds";
import { openZip, type ZipMesh } from "./zip";

/**
 * Runs the QC checks on a raw upload's bytes: magic bytes → size → header
 * fast-fail → parse → geometry and texture checks → validated report.
 * Pure: no network, no database. A hard failure before parsing stops there
 * (there's nothing more to measure); after parsing, every check runs so the
 * contributor sees all problems at once.
 */
export interface QcRunInput {
  bytes: Uint8Array;
  /** The kind the contributor uploaded (from the stored `source.<ext>` key). */
  kind: UploadKind;
  /** H2 cap for this deployment's plan. */
  maxBytes?: number;
  zipInflatedLimit?: number;
}

export interface QcRunResult {
  report: QcReport;
  /** No hard check failed, so the scan can go to review. */
  passed: boolean;
  /** Triangles, when known (also set on failure, ADR 003 §5). */
  triCount: number | null;
  /** Longest side of the smallest colour texture; null for vertex colours. */
  textureRes: number | null;
  /** For the canonical-GLB step; null when parsing failed. */
  mesh: ParsedMesh | null;
  /** The source glTF document, for GLB/glTF inputs. */
  document: Document | null;
  stats: MeshStats | null;
  /** Private: goes to the job row and logs, never the report. */
  metrics: QcMetrics;
}

const GENERIC_CORRUPT =
  "The file couldn't be read; it may be damaged. Re-export and upload again.";

type Source =
  | { kind: "glb" }
  | { kind: "gltf"; json: ReturnType<typeof readGltfJson>; zip?: ZipMesh }
  | { kind: "ply" }
  | { kind: "obj"; text: string; zip: ZipMesh };

export async function runQcChecks(input: QcRunInput): Promise<QcRunResult> {
  const { bytes, kind } = input;
  const timer = new StageTimer();
  const checks: QcCheckResult[] = [];
  let mesh: ParsedMesh | null = null;
  let document: Document | null = null;
  let stats: MeshStats | null = null;
  let triCount: number | null = null;

  const finish = (): QcRunResult => {
    const textureRes = checks.find((c) => c.id === "texture_res")?.data
      ?.longest_px;
    const report = buildQcReport(checks, stats?.extents ?? null);
    return {
      report,
      passed: qcPassed(report),
      triCount,
      textureRes: typeof textureRes === "number" ? textureRes : null,
      mesh,
      document,
      stats,
      metrics: timer.done(),
    };
  };
  const failed = () => checks.some((c) => c.severity === "error" && !c.pass);

  // H1, H2: no parsing at all.
  await timer.run("sniff", () => {
    checks.push(checkFileType(kind, sniff(bytes)));
    if (!failed()) {
      checks.push(checkFileSize(bytes.length, input.maxBytes ?? MAX_RAW_BYTES));
    }
  });
  if (failed()) return finish();

  // H3 from the header (GLB JSON chunk, PLY header, zip central directory).
  const source = await timer.run("header", (): Source | null => {
    try {
      let headerTris: number;
      let found: Source;
      if (kind === "glb") {
        headerTris = gltfJsonTriangleCount(readGlbJson(bytes));
        found = { kind: "glb" };
      } else if (kind === "gltf") {
        const json = readGltfJson(bytes);
        headerTris = gltfJsonTriangleCount(json);
        found = { kind: "gltf", json };
      } else if (kind === "ply") {
        headerTris = plyHeaderFaceCount(parsePlyHeader(bytes));
        found = { kind: "ply" };
      } else {
        const zip = openZip(
          bytes,
          input.zipInflatedLimit ?? ZIP_INFLATED_BYTES_LIMIT,
        );
        if (zip.kind === "obj") {
          const text = new TextDecoder().decode(zip.mesh);
          headerTris = objFaceLineCount(text);
          found = { kind: "obj", text, zip };
        } else {
          const json = readGltfJson(zip.mesh);
          headerTris = gltfJsonTriangleCount(json);
          found = { kind: "gltf", json, zip };
        }
      }
      checks.push(checkTooLarge(headerTris));
      return found;
    } catch (e) {
      if (e instanceof MeshParseError && e.reason === "too_large") {
        checks.push(checkZipTooLarge(e.message));
      } else {
        checks.push(
          checkParse(e instanceof MeshParseError ? e.message : GENERIC_CORRUPT),
        );
      }
      return null;
    }
  });
  if (failed() || !source) return finish();

  // H4: full parse.
  const src = source;
  await timer.run("parse", async () => {
    try {
      if (src.kind === "glb" || src.kind === "gltf") {
        document =
          src.kind === "glb"
            ? await readGltfDocument({ kind: "glb", bytes })
            : await readGltfDocument({
                kind: "gltf",
                json: src.json,
                resolve: src.zip?.resolve ?? (() => null),
              });
        mesh = flattenDocument(document, src.kind);
      } else if (src.kind === "ply") {
        mesh = parsePly(bytes);
      } else {
        mesh = parseObj(src.text, src.zip.resolve);
      }
      checks.push(checkParse(null));
    } catch (e) {
      document = null;
      checks.push(
        checkParse(e instanceof MeshParseError ? e.message : GENERIC_CORRUPT),
      );
    }
  });
  const parsed = mesh as ParsedMesh | null;
  if (!parsed) return finish();

  // H5–H10, S1–S4 on the parsed mesh.
  await timer.run("checks", () => {
    const s = measureMesh(parsed);
    stats = s;
    triCount = s.triCount;
    checks.push(
      checkTriCount(s.triCount),
      checkScale(s.extents),
      checkVolume(s.volumeRatio),
      checkFloaters(s.floaterFraction),
      checkColor({
        textures: parsed.textures,
        vertexColors: parsed.colors !== null,
        missingTextures: parsed.missingTextures,
      }),
    );
    const tex = checkTextureResolution(parsed.textures);
    if (tex) checks.push(tex);
    checks.push(checkMeshQuality(s));
  });
  return finish();
}
