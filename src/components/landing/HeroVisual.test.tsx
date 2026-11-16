import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeroVisual } from "./HeroVisual";

const mode = vi.hoisted(() => ({
  value: { checked: true, live: false, paused: false },
}));
vi.mock("./heroMode", () => ({ useHeroMode: () => mode.value }));
vi.mock("@/components/viewer/hero/HeroViewer", () => ({
  default: ({
    onReady,
    onActiveClimb,
  }: {
    onReady?: () => void;
    onActiveClimb?: (c: { name: string; grade: string | null }) => void;
  }) => (
    <button
      data-testid="hero-canvas"
      onClick={() => {
        onReady?.();
        onActiveClimb?.({ name: "Demo Arete", grade: "V2" });
      }}
    />
  ),
}));

describe("HeroVisual", () => {
  beforeEach(() => {
    mode.value = { checked: true, live: false, paused: false };
  });

  it("shows only the described poster without WebGL / with reduced motion", () => {
    render(<HeroVisual />);
    const box = screen.getByRole("img", {
      name: /3D scan of the demo boulder/,
    });
    expect(box.getAttribute("data-hero-state")).toBe("poster");
    expect(screen.queryByTestId("hero-canvas")).toBeNull();
  });

  it("lazy-mounts the canvas once the mode is live", async () => {
    mode.value = { checked: true, live: true, paused: false };
    render(<HeroVisual />);
    expect(await screen.findByTestId("hero-canvas")).toBeTruthy();
    expect(
      screen
        .getByRole("img", { name: /3D scan/ })
        .getAttribute("data-hero-state"),
    ).toBe("loading");
  });

  it("hides the poster once the canvas is ready, so no second rock shows through", async () => {
    mode.value = { checked: true, live: true, paused: false };
    const { container } = render(<HeroVisual />);
    const poster = container.querySelector("img") as HTMLImageElement;
    expect(poster.className).toContain("opacity-100");
    fireEvent.click(await screen.findByTestId("hero-canvas"));
    expect(poster.className).toContain("opacity-0");
    expect(poster.className).not.toContain("opacity-100");
  });

  it("keeps the poster visible when the canvas is not live", () => {
    const { container } = render(<HeroVisual />);
    const poster = container.querySelector("img") as HTMLImageElement;
    expect(poster.className).toContain("opacity-100");
  });

  it("captions the climb that is facing the camera", async () => {
    mode.value = { checked: true, live: true, paused: false };
    render(<HeroVisual />);
    expect(screen.queryByTestId("hero-caption")).toBeNull();
    fireEvent.click(await screen.findByTestId("hero-canvas"));
    expect(screen.getByTestId("hero-caption").textContent).toBe(
      "Demo Arete · V2",
    );
  });
});
