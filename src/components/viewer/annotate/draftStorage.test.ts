import { describe, expect, it } from "vitest";
import type { Snapshot } from "./editorStore";
import {
  draftIdFor,
  draftKey,
  loadDraft,
  saveDraft,
  type DraftStorage,
} from "./draftStorage";

const mem = (): DraftStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

const snap = (name: string): Snapshot => ({
  holds: [],
  paths: [],
  meta: { name, description: "", proposed_grade: "V3", fa_info: "" },
});

describe("draft keys", () => {
  it("keeps the new-climb key unchanged, so existing drafts survive", () => {
    expect(draftIdFor("s1")).toBe("s1");
    expect(draftIdFor("s1", null)).toBe("s1");
    expect(draftKey(draftIdFor("s1"))).toBe("sandbag:draft:v1:s1");
  });

  it("gives each edited climb its own key", () => {
    expect(draftIdFor("s1", "c1")).not.toBe(draftIdFor("s1"));
    expect(draftIdFor("s1", "c1")).not.toBe(draftIdFor("s1", "c2"));
  });

  it("an edit draft and a new-climb draft never overwrite each other", () => {
    const st = mem();
    saveDraft(st, draftIdFor("s1"), "h", snap("new climb"));
    saveDraft(st, draftIdFor("s1", "c1"), "h", snap("edit of c1"));
    const nu = loadDraft(st, draftIdFor("s1"), "h");
    const ed = loadDraft(st, draftIdFor("s1", "c1"), "h");
    expect(nu.status === "restored" && nu.snapshot.meta.name).toBe("new climb");
    expect(ed.status === "restored" && ed.snapshot.meta.name).toBe(
      "edit of c1",
    );
    expect(st.data.size).toBe(2);
  });
});
