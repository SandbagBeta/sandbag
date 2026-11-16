import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeroVisual } from "./HeroVisual";

const mode = vi.hoisted(() => ({
  value: { checked: true, live: false, paused: false },
}));
vi.mock("./heroMode", () => ({ useHeroMode: () => mode.value }));
vi.mock("@/components/viewer/hero/HeroViewer", () => ({
  default: () => <div data-testid="hero-canvas" />,
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
});
