import type { QcCheckResult } from "../types";
import type { UploadKind } from "../upload/validate";
import { fileTypeLabel, fileTypeMismatch, type Sniffed } from "./detect";
import type { TextureSize } from "./mesh";
import {
  DEGENERATE_FACE_FRACTION,
  FLOATER_HARD_FRACTION,
  FLOATER_SOFT_FRACTION,
  MAX_RAW_BYTES,
  NON_MANIFOLD_EDGE_FRACTION,
  SCALE_HARD_HIGH_M,
  SCALE_HARD_LOW_M,
  SCALE_SOFT_HIGH_M,
  SCALE_SOFT_LOW_M,
  TEXTURE_HARD_PX,
  TEXTURE_SOFT_PX,
  TRI_COUNT_LIMIT_HIGH,
  TRI_COUNT_LIMIT_LOW,
  VOLUME_RATIO_LIMIT,
} from "./thresholds";

/**
 * The ADR 003 §8 checks, each a small pure function. Conventions:
 * - `severity` is the check's class when it passes (`error` for hard checks),
 *   and the outcome when it fails: `error` fails QC, `warning` goes to review.
 * - `message` is built only from these templates and numbers, never from
 *   file contents (names, EXIF, …), because reports are public.
 * - `data` keys avoid min/max/name/file/… (assertQcReport refuses them):
 *   thresholds are `limit_*`.
 */

export type CheckId =
  | "file_type"
  | "file_size"
  | "too_large"
  | "parse"
  | "tri_count"
  | "scale"
  | "volume"
  | "floaters"
  | "color"
  | "texture_res"
  | "mesh_quality";

type Result = QcCheckResult & { id: CheckId };

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (f: number) => `${Math.round(f * 100)}%`;
const round = (n: number, digits = 4) => Number(n.toPrecision(digits));
const millions = (n: number) => `${round(n / 1e6, 2)}M`;
/** Megabytes (MiB, as the upload limits are), 2 significant figures below 10. */
function mb(bytes: number): string {
  const v = bytes / (1024 * 1024);
  return `${v < 10 ? round(v, 2) : int(v)} MB`;
}

/** Metres for messages: 2 significant figures, whole metres from 100 m. */
function metres(m: number): string {
  return m >= 100 ? int(m) : String(round(m, 2));
}

/** H1: extension and magic bytes agree. */
export function checkFileType(kind: UploadKind, sniffed: Sniffed): Result {
  const mismatch = fileTypeMismatch(kind, sniffed);
  return {
    id: "file_type",
    pass: mismatch === null,
    severity: "error",
    message:
      mismatch ?? `The file is ${fileTypeLabel(kind)}, as its name says.`,
  };
}

/** H2: raw size within the plan's cap. */
export function checkFileSize(bytes: number, limit = MAX_RAW_BYTES): Result {
  const pass = bytes <= limit;
  return {
    id: "file_size",
    pass,
    severity: "error",
    message: pass
      ? `The file is ${mb(bytes)} (limit ${mb(limit)}).`
      : `This file is ${mb(bytes)}; the limit is ${mb(limit)}. Decimate the mesh or shrink the texture and upload again.`,
    data: { bytes, limit_bytes: limit },
  };
}

/** H3: header triangle count under the cap, before anything is parsed (O16). */
export function checkTooLarge(headerTriangles: number): Result {
  const pass = headerTriangles <= TRI_COUNT_LIMIT_HIGH;
  return {
    id: "too_large",
    pass,
    severity: "error",
    message: pass
      ? `The file lists ${int(headerTriangles)} triangles, under the ${millions(TRI_COUNT_LIMIT_HIGH)} limit.`
      : `This scan is too large: ${millions(headerTriangles)} triangles; the limit is ${millions(TRI_COUNT_LIMIT_HIGH)}. Decimate it to under ${millions(TRI_COUNT_LIMIT_HIGH)} triangles and upload again.`,
    data: { triangles: headerTriangles, limit_triangles: TRI_COUNT_LIMIT_HIGH },
  };
}

/** H3 for zips, whose triangle count isn't known until they're unpacked. */
export function checkZipTooLarge(message: string): Result {
  return { id: "too_large", pass: false, severity: "error", message };
}

/** H4: the file parses and has a triangle mesh. `failure` is a fixed template. */
export function checkParse(failure: string | null): Result {
  return {
    id: "parse",
    pass: failure === null,
    severity: "error",
    message: failure ?? "The mesh loaded.",
  };
}

/** H5 (and the 5M cap again, for formats without a header count). */
export function checkTriCount(count: number): Result {
  const low = count < TRI_COUNT_LIMIT_LOW;
  const high = count > TRI_COUNT_LIMIT_HIGH;
  return {
    id: "tri_count",
    pass: !low && !high,
    severity: "error",
    message: low
      ? `Only ${int(count)} triangles; we need at least ${int(TRI_COUNT_LIMIT_LOW)}. Export at a higher mesh quality.`
      : high
        ? `This scan is too large: ${millions(count)} triangles; the limit is ${millions(TRI_COUNT_LIMIT_HIGH)}. Decimate it to under ${millions(TRI_COUNT_LIMIT_HIGH)} triangles and upload again.`
        : `${int(count)} triangles.`,
    data: {
      count,
      limit_low: TRI_COUNT_LIMIT_LOW,
      limit_high: TRI_COUNT_LIMIT_HIGH,
    },
  };
}

/** Units the export was probably in, when that would bring it into range. */
function likelyUnit(longest: number): string | null {
  const fits = (m: number) => m >= SCALE_HARD_LOW_M && m <= SCALE_HARD_HIGH_M;
  if (longest > SCALE_HARD_HIGH_M) {
    if (fits(longest / 1000)) return "millimetres";
    if (fits(longest / 100)) return "centimetres";
  } else if (fits(longest * 1000)) {
    return "kilometres";
  }
  return null;
}

/** H6 / S3: longest bounding-box extent is boulder-sized. */
export function checkScale(extents: readonly [number, number, number]): Result {
  const longest = Math.max(...extents);
  const data = {
    longest_m: round(longest),
    limit_low_m: SCALE_HARD_LOW_M,
    limit_high_m: SCALE_HARD_HIGH_M,
  };
  const size = `${metres(longest)} m across`;
  if (longest < SCALE_HARD_LOW_M || longest > SCALE_HARD_HIGH_M) {
    const unit = likelyUnit(longest);
    const why = unit
      ? `It was probably exported in ${unit}; export in metres.`
      : `A boulder should be ${SCALE_HARD_LOW_M}–${SCALE_HARD_HIGH_M} m. Check the export units (metres) and crop the scan to the boulder.`;
    return {
      id: "scale",
      pass: false,
      severity: "error",
      message: `The scan is ${size}. ${why}`,
      data,
    };
  }
  if (longest < SCALE_SOFT_LOW_M || longest > SCALE_SOFT_HIGH_M) {
    const hint =
      longest < SCALE_SOFT_LOW_M
        ? "small for a boulder (most are 2 m or more). Check you exported in metres; a wrongly sized scan makes hold markers and distances the wrong size. If the size is right, nothing to do: a reviewer checks the scale before publishing and can correct it."
        : "large for a boulder. Check you exported in metres and that the scan is cropped to the boulder. If the size is right, nothing to do: a reviewer checks the scale before publishing and can correct it.";
    return {
      id: "scale",
      pass: false,
      severity: "warning",
      message: `The scan is ${size}, which is ${hint}`,
      data,
    };
  }
  return {
    id: "scale",
    pass: true,
    severity: "error",
    message: `The scan is ${size}.`,
    data,
  };
}

/** H7: not flat or degenerate. */
export function checkVolume(volumeRatio: number): Result {
  const pass = volumeRatio >= VOLUME_RATIO_LIMIT;
  return {
    id: "volume",
    pass,
    severity: "error",
    message: pass
      ? "The mesh has volume."
      : "The mesh is flat (no volume). Check that the whole boulder was captured.",
    data: { ratio: round(volumeRatio), limit_ratio: VOLUME_RATIO_LIMIT },
  };
}

/** H8 / S2: most of the mesh is one connected piece. */
export function checkFloaters(fraction: number): Result {
  const data = {
    fraction: round(fraction),
    limit_fraction: FLOATER_HARD_FRACTION,
    warn_fraction: FLOATER_SOFT_FRACTION,
  };
  const share = `${pct(fraction)} of the mesh is disconnected floating pieces.`;
  if (fraction >= FLOATER_HARD_FRACTION) {
    return {
      id: "floaters",
      pass: false,
      severity: "error",
      message: `${share} Crop the scan to the boulder before exporting.`,
      data,
    };
  }
  if (fraction >= FLOATER_SOFT_FRACTION) {
    return {
      id: "floaters",
      pass: false,
      severity: "warning",
      message: `${share} A reviewer will take a look; cropping the scan to the boulder before exporting avoids this.`,
      data,
    };
  }
  return {
    id: "floaters",
    pass: true,
    severity: "error",
    message:
      fraction > 0
        ? `${pct(fraction)} of the mesh is floating pieces (fine).`
        : "The mesh is one connected piece.",
    data,
  };
}

/** H9: some colour, from an image texture or vertex colours (O6). */
export function checkColor(input: {
  textures: readonly TextureSize[];
  vertexColors: boolean;
  missingTextures: number;
}): Result {
  const pass = input.textures.length > 0 || input.vertexColors;
  const data = {
    image_textures: input.textures.length,
    vertex_colors: input.vertexColors,
    missing_textures: input.missingTextures,
  };
  if (pass) {
    return {
      id: "color",
      pass,
      severity: "error",
      message:
        input.textures.length > 0
          ? "The scan has a colour texture."
          : "The scan is coloured with vertex colours.",
      data,
    };
  }
  return {
    id: "color",
    pass,
    severity: "error",
    message:
      input.missingTextures > 0
        ? "The material points to a texture image that isn't in the upload (or can't be read). Zip the texture with the mesh, or export a GLB with the texture embedded."
        : "The scan has no colour: no texture image and no vertex colours. Export with textures (or vertex colours) turned on.",
    data,
  };
}

/**
 * H10 / S1: longest side of the smallest colour texture. Only for image
 * textures (O6): returns null when there are none, so no check is reported.
 */
export function checkTextureResolution(
  textures: readonly TextureSize[],
): Result | null {
  if (textures.length === 0) return null;
  const longest = Math.min(...textures.map((t) => Math.max(t.width, t.height)));
  const data = {
    longest_px: longest,
    limit_px: TEXTURE_HARD_PX,
    warn_px: TEXTURE_SOFT_PX,
  };
  const guide = "(see the capture guide)";
  if (longest < TEXTURE_HARD_PX) {
    return {
      id: "texture_res",
      pass: false,
      severity: "error",
      message: `The texture is ${int(longest)} px; we need at least ${int(TEXTURE_HARD_PX)} px. Export at ${int(TEXTURE_SOFT_PX)} px ${guide}.`,
      data,
    };
  }
  if (longest < TEXTURE_SOFT_PX) {
    return {
      id: "texture_res",
      pass: false,
      severity: "warning",
      message: `The texture is ${int(longest)} px; export at ${int(TEXTURE_SOFT_PX)} px for a sharper result ${guide}.`,
      data,
    };
  }
  return {
    id: "texture_res",
    pass: true,
    severity: "error",
    message: `The texture is ${int(longest)} px.`,
    data,
  };
}

/** S4: few degenerate faces and non-manifold edges. Soft only. */
export function checkMeshQuality(input: {
  triCount: number;
  degenerateFaces: number;
  edges: number;
  nonManifoldEdges: number;
}): Result {
  const degenerate = input.triCount
    ? input.degenerateFaces / input.triCount
    : 0;
  const nonManifold = input.edges ? input.nonManifoldEdges / input.edges : 0;
  const badDegenerate = degenerate > DEGENERATE_FACE_FRACTION;
  const badManifold = nonManifold > NON_MANIFOLD_EDGE_FRACTION;
  const problems = [
    badDegenerate && `${pct(degenerate)} of faces are degenerate (zero area)`,
    badManifold && `${pct(nonManifold)} of edges are non-manifold`,
  ].filter(Boolean);
  return {
    id: "mesh_quality",
    pass: problems.length === 0,
    severity: "warning",
    message: problems.length
      ? `${problems.join(" and ")}. A reviewer will take a look; your app's mesh clean-up option before exporting usually fixes this.`
      : "No significant mesh defects.",
    data: {
      degenerate_fraction: round(degenerate),
      non_manifold_fraction: round(nonManifold),
      limit_fraction: DEGENERATE_FACE_FRACTION,
    },
  };
}
