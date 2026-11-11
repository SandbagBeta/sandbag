/**
 * Scan/climb lifecycle and the review/publish flow (PRD §6, §8, issues #16,
 * #20). The only module allowed to write `status` on scans or climbs.
 *
 * `transitions` and `qc-report` are pure and safe anywhere (e.g. to grey out
 * buttons in the review queue, #19). `applyTransition`, `submitReview` and
 * `takeDown` take the service-role client and are SERVER ONLY.
 *
 * `internal.ts` is deliberately not re-exported: its raw compare-and-set
 * skips the transition table.
 */
export * from "./transitions";
export * from "./apply";
export * from "./qc-report";
export * from "./review";
export * from "./takedown";
