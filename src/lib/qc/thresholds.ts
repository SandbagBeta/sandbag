/**
 * QC thresholds (ADR 003 §8). Hard values are PRD §9's; soft values are the
 * ADR's starting points. Change them only in a reviewed PR, never to make a
 * test pass (lane guide).
 */

/** Bumped whenever a check, threshold or the pinned toolchain changes. */
export const QC_PIPELINE_VERSION = "qc-1.1.0";

/** H2: raw file size cap (self-host / paid; hosted Free is 50 MB, ADR 002 D2). */
export const MAX_RAW_BYTES = 200 * 1024 * 1024;

/** H3 / H5: triangle count range (PRD §9, O16). */
export const TRI_COUNT_LIMIT_LOW = 10_000;
export const TRI_COUNT_LIMIT_HIGH = 5_000_000;

/** H6: longest bounding-box extent, metres. Outside this range fails. */
export const SCALE_HARD_LOW_M = 0.3;
export const SCALE_HARD_HIGH_M = 30;
/** S3: inside the hard range but outside this one warns ("check the units"). */
export const SCALE_SOFT_LOW_M = 0.5;
export const SCALE_SOFT_HIGH_M = 20;

/** H7: enclosed volume below this fraction of the bounding-box volume fails. */
export const VOLUME_RATIO_LIMIT = 0.001;

/** H8 / S2: fraction of vertices outside the largest connected piece. */
export const FLOATER_HARD_FRACTION = 0.5;
export const FLOATER_SOFT_FRACTION = 0.2;

/** H10 / S1: longest side of the colour texture, px (image textures only, O6). */
export const TEXTURE_HARD_PX = 1024;
export const TEXTURE_SOFT_PX = 2048;

/** S4: degenerate-face and non-manifold-edge fractions that warn. */
export const DEGENERATE_FACE_FRACTION = 0.01;
export const NON_MANIFOLD_EDGE_FRACTION = 0.01;

/**
 * Zip bombs (ADR 003 §6): total uncompressed bytes of the entries we inflate,
 * read from the central directory before inflating. OBJ text is ~2–3× binary
 * PLY per triangle, so 5M triangles is roughly 250–350 MB of OBJ.
 */
export const ZIP_INFLATED_BYTES_LIMIT = 500_000_000;

/** Positions closer than this (metres) are one vertex for topology checks. */
export const WELD_EPSILON_M = 1e-5;
