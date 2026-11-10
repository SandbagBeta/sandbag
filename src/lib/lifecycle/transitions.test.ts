import { describe, expect, it } from "vitest";
import {
  assertTransition,
  INITIAL_STATUS,
  InvalidTransitionError,
  LIFECYCLE_STATUSES,
  type LifecycleKind,
} from "./transitions";

// PRD §8, written out independently of TRANSITIONS so the table can't drift silently.
const LEGAL: Record<LifecycleKind, string[]> = {
  scan: [
    "uploaded>processing",
    "processing>failed_qc",
    "processing>pending_review",
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
      /published is not a state a climb can leave/,
    );
  });

  it("starts scans at uploaded and climbs at pending_review (schema defaults)", () => {
    expect(INITIAL_STATUS).toEqual({
      scan: "uploaded",
      climb: "pending_review",
    });
  });
});
