"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorStore } from "./editorStore";
import type { StoreApi } from "zustand";
import {
  browserStorage,
  clearDraft,
  isEmptySnapshot,
  loadDraft,
  type DraftLoad,
  saveDraft,
  type DraftStorage,
} from "./draftStorage";

export type DraftNotice =
  | { kind: "restored"; savedAt: number }
  | { kind: "stale"; savedAt: number }
  | null;

const DEBOUNCE_MS = 500;
const NONE: DraftLoad = { status: "none" };

/**
 * Restores the saved draft once on mount (with a notice), then mirrors every
 * edit into storage. `discard` empties the editor and the stored draft;
 * `clear` (after a successful save) removes the stored draft for good.
 */
export function useDraft(
  store: StoreApi<EditorStore>,
  scanId: string | undefined,
  scanContentHash: string,
  storage: DraftStorage | null = browserStorage(),
) {
  // Read once (the viewer is client-only); the effect applies it to the store.
  const [loaded] = useState(() =>
    scanId ? loadDraft(storage, scanId, scanContentHash) : NONE,
  );
  const [notice, setNotice] = useState<DraftNotice>(
    loaded.status === "none"
      ? null
      : { kind: loaded.status, savedAt: loaded.savedAt },
  );
  const stopped = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!scanId) return;
    stopped.current = false;
    if (loaded.status === "restored") store.getState().restore(loaded.snapshot);
    const unsub = store.subscribe((s, prev) => {
      if (stopped.current) return;
      if (
        s.holds === prev.holds &&
        s.paths === prev.paths &&
        s.meta === prev.meta
      )
        return;
      clearTimeout(timer.current);
      timer.current = setTimeout(
        () => saveDraft(storage, scanId, scanContentHash, s),
        DEBOUNCE_MS,
      );
    });
    return () => {
      unsub();
      clearTimeout(timer.current);
    };
  }, [store, scanId, scanContentHash, storage]);

  const clear = useCallback(() => {
    stopped.current = true;
    clearTimeout(timer.current);
    if (scanId) clearDraft(storage, scanId);
  }, [scanId, storage]);

  const discard = useCallback(() => {
    clearTimeout(timer.current);
    if (scanId) clearDraft(storage, scanId);
    const s = store.getState();
    if (!isEmptySnapshot(s))
      s.restore({
        holds: [],
        paths: [],
        meta: { name: "", description: "", proposed_grade: "", fa_info: "" },
      });
    setNotice(null);
  }, [store, scanId, storage]);

  return { notice, discard, clear, dismiss: () => setNotice(null) };
}
