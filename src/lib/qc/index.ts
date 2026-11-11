import "server-only";

/**
 * QC pipeline core (#16, ADR 003). Server-only: it reads raw uploads, which
 * may carry location metadata, and loads wasm decoders. PR 1 of 3 is the
 * pure part (parsers, checks, report); canonical output and wiring follow.
 */
export { runQcChecks, type QcRunInput, type QcRunResult } from "./run";
export { formatMetrics, type QcMetrics } from "./metrics";
export { QC_PIPELINE_VERSION } from "./thresholds";
export type { ParsedMesh } from "./mesh";
