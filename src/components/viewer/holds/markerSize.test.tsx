import { afterEach, describe, expect, it, vi } from "vitest";
import { MARKER_SIZE_KEY, useMarkerSize } from "./markerSize";

afterEach(() => {
  vi.restoreAllMocks();
  useMarkerSize.setState({ percent: 100 });
  window.localStorage.clear();
});

describe("useMarkerSize", () => {
  it("persists changes and hydrates them", () => {
    useMarkerSize.getState().setPercent(150);
    expect(window.localStorage.getItem(MARKER_SIZE_KEY)).toBe("150");
    useMarkerSize.setState({ percent: 100 });
    useMarkerSize.getState().hydrate();
    expect(useMarkerSize.getState().percent).toBe(150);
  });
  it("ignores a corrupt stored value", () => {
    window.localStorage.setItem(MARKER_SIZE_KEY, "banana");
    useMarkerSize.getState().hydrate();
    expect(useMarkerSize.getState().percent).toBe(100);
  });
  it("still works when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    useMarkerSize.getState().setPercent(80);
    expect(useMarkerSize.getState().percent).toBe(80);
    useMarkerSize.getState().hydrate();
    expect(useMarkerSize.getState().percent).toBe(100);
  });
});
