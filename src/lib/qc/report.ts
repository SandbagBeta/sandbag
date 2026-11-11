import { assertQcReport } from "../lifecycle/qc-report";
import type { QcCheckResult, QcExtents, QcReport } from "../types";
import { QC_PIPELINE_VERSION } from "./thresholds";

/**
 * Assembles the public `qc_report` from check results and the mesh extents,
 * and validates it with the lifecycle module's allow-list before anyone can
 * write it. Extents only, never corners (ADR 003 §5).
 */
export function buildQcReport(
  checks: QcCheckResult[],
  extents: readonly [number, number, number] | null,
): QcReport {
  const mm = (m: number) => Math.round(m * 1000) / 1000;
  const extents_m: QcExtents | null = extents
    ? { width: mm(extents[0]), height: mm(extents[1]), depth: mm(extents[2]) }
    : null;
  const report: QcReport = {
    pipeline_version: QC_PIPELINE_VERSION,
    checks,
    extents_m,
  };
  assertQcReport(report);
  return report;
}
