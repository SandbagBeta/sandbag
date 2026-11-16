import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasWebGL, useHeroMode } from "./heroMode";

function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: reduce,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

function stubWebGL(available: boolean) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((
    kind: string,
  ) => (available && kind === "webgl2" ? {} : null)) as never);
}

let ioCallback: IntersectionObserverCallback | null = null;

beforeEach(() => {
  ioCallback = null;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IntersectionObserverCallback) {
        ioCallback = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("hasWebGL", () => {
  it("is false when no context can be created", () => {
    stubWebGL(false);
    expect(hasWebGL()).toBe(false);
  });
  it("is true when a context exists", () => {
    stubWebGL(true);
    expect(hasWebGL()).toBe(true);
  });
  it("is false (not a throw) when getContext throws", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => {
        throw new Error("blocked");
      },
    );
    expect(hasWebGL()).toBe(false);
  });
});

describe("useHeroMode", () => {
  const box = { current: document.createElement("div") };

  it("goes live with WebGL and no reduced-motion preference", () => {
    stubMatchMedia(false);
    stubWebGL(true);
    const { result } = renderHook(() => useHeroMode(box));
    expect(result.current).toEqual({
      checked: true,
      live: true,
      paused: false,
    });
  });

  it("stays on the poster for prefers-reduced-motion", () => {
    stubMatchMedia(true);
    stubWebGL(true);
    const { result } = renderHook(() => useHeroMode(box));
    expect(result.current.live).toBe(false);
    expect(result.current.checked).toBe(true);
  });

  it("stays on the poster without WebGL", () => {
    stubMatchMedia(false);
    stubWebGL(false);
    const { result } = renderHook(() => useHeroMode(box));
    expect(result.current.live).toBe(false);
  });

  it("pauses when scrolled off-screen and resumes", () => {
    stubMatchMedia(false);
    stubWebGL(true);
    const { result } = renderHook(() => useHeroMode(box));
    const fire = (isIntersecting: boolean) =>
      act(() =>
        ioCallback?.(
          [{ isIntersecting } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        ),
      );
    fire(false);
    expect(result.current.paused).toBe(true);
    fire(true);
    expect(result.current.paused).toBe(false);
  });

  it("pauses while the tab is hidden", () => {
    stubMatchMedia(false);
    stubWebGL(true);
    const { result } = renderHook(() => useHeroMode(box));
    const vis = vi.spyOn(document, "visibilityState", "get");
    vis.mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.paused).toBe(true);
    vis.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.paused).toBe(false);
  });
});
