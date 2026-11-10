/**
 * Scan/climb lifecycle and the review/publish flow (PRD §6, §8, issue #20).
 * The only module allowed to write `status` on scans or climbs.
 *
 * `transitions` is pure and safe anywhere (e.g. to grey out buttons in the
 * review queue, #19). `applyTransition` and `submitReview` take the
 * service-role client and are SERVER ONLY.
 */
export * from "./transitions";
export * from "./apply";
export * from "./review";
