import type { QcReport, QcSeverity } from "../types";
import { LifecycleError } from "./transitions";

/**
 * Runtime guard for `scans.qc_report` (ADR 003 §5). Published scan rows are
 * public in full, so a report is checked against an allow-list before the
 * lifecycle module writes it: unknown keys anywhere are refused rather than
 * stripped, so a pipeline bug fails loudly instead of leaking.
 *
 * Not covered (free text can't be checked mechanically): check `message`
 * strings. The pipeline must build them from its own templates, never from
 * file contents.
 */

export class InvalidQcReportError extends LifecycleError {}

const REPORT_KEYS = new Set([
  "pipeline_version",
  "checks",
  "extents_m",
  "recentred",
]);
const CHECK_KEYS = new Set(["id", "pass", "severity", "message", "data"]);
const EXTENT_KEYS = ["width", "height", "depth"] as const;
const SEVERITIES: readonly QcSeverity[] = ["error", "warning", "info"];

/**
 * `data` keys that name location or identifying metadata. Matched per
 * `_`-separated token, case-insensitive. Fails closed: e.g. use `limit`
 * rather than `min`/`max` for thresholds, because bbox corners are min/max.
 */
const FORBIDDEN_DATA_TOKEN =
  /(^|_)(lat|lng|lon|latitude|longitude|coord|coords|coordinates|gps|exif|geo|utm|ecef|offset|origin|corner|corners|bbox|bounds|min|max|file|filename|name|path)(_|$)/i;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function fail(message: string): never {
  throw new InvalidQcReportError(`Invalid qc_report: ${message}`);
}

function unknownKeys(obj: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(obj).filter((k) => !allowed.has(k));
}

export function assertQcReport(value: unknown): asserts value is QcReport {
  if (!isObject(value)) fail("must be an object.");
  const extra = unknownKeys(value, REPORT_KEYS);
  if (extra.length) fail(`unknown key(s) ${extra.join(", ")}.`);

  const { pipeline_version, checks, extents_m, recentred } = value;
  if (typeof pipeline_version !== "string" || !pipeline_version.trim()) {
    fail("pipeline_version must be a non-empty string.");
  }
  if (!Array.isArray(checks) || checks.length === 0) {
    fail("checks must be a non-empty array.");
  }
  checks.forEach((c: unknown, i) => {
    if (!isObject(c)) fail(`checks[${i}] must be an object.`);
    const bad = unknownKeys(c, CHECK_KEYS);
    if (bad.length) fail(`checks[${i}] has unknown key(s) ${bad.join(", ")}.`);
    if (typeof c.id !== "string" || !c.id) fail(`checks[${i}].id is required.`);
    if (typeof c.pass !== "boolean") fail(`checks[${i}].pass must be boolean.`);
    if (!SEVERITIES.includes(c.severity as QcSeverity)) {
      fail(`checks[${i}].severity must be one of ${SEVERITIES.join(", ")}.`);
    }
    if (typeof c.message !== "string" || !c.message.trim()) {
      fail(`checks[${i}].message is required.`);
    }
    if (c.data === undefined) return;
    if (!isObject(c.data)) fail(`checks[${i}].data must be an object.`);
    for (const [k, v] of Object.entries(c.data)) {
      if (FORBIDDEN_DATA_TOKEN.test(k)) {
        fail(
          `checks[${i}].data.${k} looks like location or identifying metadata.`,
        );
      }
      if (
        typeof v !== "boolean" &&
        !(typeof v === "number" && Number.isFinite(v))
      ) {
        fail(`checks[${i}].data.${k} must be a finite number or boolean.`);
      }
    }
  });

  if (extents_m !== undefined && extents_m !== null) {
    if (!isObject(extents_m)) fail("extents_m must be an object.");
    const bad = unknownKeys(extents_m, new Set(EXTENT_KEYS));
    if (bad.length)
      fail(
        `extents_m has unknown key(s) ${bad.join(", ")} (extents only, never corners).`,
      );
    for (const k of EXTENT_KEYS) {
      const v = extents_m[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        fail(`extents_m.${k} must be a finite number >= 0.`);
      }
    }
  }
  if (recentred !== undefined && typeof recentred !== "boolean") {
    fail("recentred must be boolean.");
  }
}

/** Errors fail QC; warnings and info pass to review (ADR 003, owner decision). */
export function qcPassed(report: QcReport): boolean {
  return !report.checks.some((c) => c.severity === "error" && !c.pass);
}
