import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  INITIAL_STATUS,
  InvalidTransitionError,
  LIFECYCLE_STATUSES,
  TAKEDOWN,
  TRANSITIONS,
  type LifecycleKind,
} from "./transitions";

// PRD §8 + owner decisions (2026-11-10), written out independently of
// TRANSITIONS so the table can't drift silently. published>rejected
// (takedown) is deliberately absent: only takeDown() may make it.
const LEGAL: Record<LifecycleKind, string[]> = {
  scan: [
    "uploaded>processing",
    "processing>failed_qc",
    "processing>pending_review",
    "failed_qc>processing",
    "pending_review>published",
    "pending_review>rejected",
  ],
  climb: ["pending_review>published", "pending_review>rejected"],
};

const kinds: LifecycleKind[] = ["scan", "climb"];
const matrix = kinds.flatMap((kind) =>
  LIFECYCLE_STATUSES.flatMap((from) =>
    LIFECYCLE_STATUSES.map((to) => ({
      kind,
      from,
      to,
      legal: LEGAL[kind].includes(`${from}>${to}`),
    })),
  ),
);

describe("lifecycle transition matrix (PRD §8)", () => {
  it("covers every (kind, from, to) pair", () => {
    expect(matrix).toHaveLength(2 * 6 * 6);
  });

  it.each(matrix.filter((m) => m.legal))(
    "$kind: $from → $to is allowed",
    ({ kind, from, to }) => {
      expect(() => assertTransition(kind, from, to)).not.toThrow();
    },
  );

  it.each(matrix.filter((m) => !m.legal))(
    "$kind: $from → $to throws",
    ({ kind, from, to }) => {
      expect(() => assertTransition(kind, from, to)).toThrow(
        InvalidTransitionError,
      );
    },
  );

  it("rejects unknown statuses", () => {
    expect(() => assertTransition("scan", "draft", "published")).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertTransition("scan", "uploaded", "done")).toThrow(
      InvalidTransitionError,
    );
  });

  it("explains what is allowed instead", () => {
    expect(() => assertTransition("scan", "uploaded", "published")).toThrow(
      /Invalid scan transition uploaded → published\. .*only move to: processing/,
    );
    expect(() => assertTransition("climb", "published", "rejected")).toThrow(
      /published is not a state a climb can leave\. .*goes through takeDown/,
    );
  });

  it.each(kinds)(
    "%s: the takedown edge is outside the general table",
    (kind) => {
      expect(TAKEDOWN).toEqual({ from: "published", to: "rejected" });
      expect(canTransition(kind, TAKEDOWN.from, TAKEDOWN.to)).toBe(false);
    },
  );

  it.each(kinds)("%s: rejected is final (no reopen)", (kind) => {
    expect(TRANSITIONS[kind].rejected).toEqual([]);
  });

  it("starts scans at uploaded and climbs at pending_review (schema defaults)", () => {
    expect(INITIAL_STATUS).toEqual({
      scan: "uploaded",
      climb: "pending_review",
    });
  });
});
