import type { ClimbPath, Hold } from "@/lib/types";
import type { ClimbMeta, Snapshot } from "./editorStore";

/**
 * Browser-kept annotation draft (issue #22): the editor snapshot is stored in
 * localStorage per scan so a reload, crash or failed save never loses work.
 * Every storage access is wrapped: with storage blocked or full the editor
 * simply works without a draft. A draft made against a different mesh
 * (content hash) is stale: its holds cannot be reused.
 */

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const VERSION = 1;
export const draftKey = (scanId: string) =>
  `sandbag:draft:v${VERSION}:${scanId}`;

interface StoredDraft {
  v: number;
  scanContentHash: string;
  savedAt: number;
  holds: Hold[];
  paths: ClimbPath[];
  meta: ClimbMeta;
}

export type DraftLoad =
  | { status: "none" }
  | { status: "restored"; snapshot: Snapshot; savedAt: number }
  | { status: "stale"; savedAt: number };

export function browserStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const isStr = (v: unknown): v is string => typeof v === "string";

function wellFormed(d: unknown): d is StoredDraft {
  if (!d || typeof d !== "object") return false;
  const x = d as Partial<StoredDraft>;
  const m = x.meta as Partial<ClimbMeta> | undefined;
  return (
    x.v === VERSION &&
    isStr(x.scanContentHash) &&
    typeof x.savedAt === "number" &&
    Array.isArray(x.holds) &&
    x.holds.every(
      (h) => !!h && isStr(h.id) && isStr(h.type) && Array.isArray(h.position),
    ) &&
    Array.isArray(x.paths) &&
    !!m &&
    isStr(m.name) &&
    isStr(m.description) &&
    isStr(m.proposed_grade) &&
    isStr(m.fa_info)
  );
}

export function loadDraft(
  storage: DraftStorage | null,
  scanId: string,
  scanContentHash: string,
): DraftLoad {
  try {
    const raw = storage?.getItem(draftKey(scanId));
    if (!raw) return { status: "none" };
    const d: unknown = JSON.parse(raw);
    if (!wellFormed(d)) return { status: "none" };
    if (d.scanContentHash !== scanContentHash)
      return { status: "stale", savedAt: d.savedAt };
    return {
      status: "restored",
      savedAt: d.savedAt,
      snapshot: { holds: d.holds, paths: d.paths, meta: d.meta },
    };
  } catch {
    return { status: "none" };
  }
}

/** A draft with nothing in it is removed rather than stored. */
export const isEmptySnapshot = (s: Snapshot) =>
  !s.holds.length &&
  !s.paths.length &&
  !s.meta.name &&
  !s.meta.description &&
  !s.meta.proposed_grade &&
  !s.meta.fa_info;

/** Returns false when the draft could not be written (quota, blocked). */
export function saveDraft(
  storage: DraftStorage | null,
  scanId: string,
  scanContentHash: string,
  s: Snapshot,
  now = Date.now(),
): boolean {
  try {
    if (!storage) return false;
    if (isEmptySnapshot(s)) storage.removeItem(draftKey(scanId));
    else {
      const d: StoredDraft = {
        v: VERSION,
        scanContentHash,
        savedAt: now,
        holds: s.holds,
        paths: s.paths,
        meta: s.meta,
      };
      storage.setItem(draftKey(scanId), JSON.stringify(d));
    }
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(storage: DraftStorage | null, scanId: string) {
  try {
    storage?.removeItem(draftKey(scanId));
  } catch {
    // Nothing to clear without storage.
  }
}
