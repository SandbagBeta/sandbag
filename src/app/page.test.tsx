import { render, screen, within } from "@testing-library/react";
import Home from "./page";

vi.mock("@/lib/supabase/env", () => ({
  isSupabaseConfigured: () => true,
  getPublicSupabaseEnv: () => ({ url: "https://x.supabase.co", anonKey: "k" }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
const loadFeatured = vi.fn();
vi.mock("@/lib/browse/load", () => ({
  loadFeatured: (...a: unknown[]) => loadFeatured(...a),
}));

beforeEach(() => {
  loadFeatured.mockReset().mockResolvedValue([]);
});

describe("Home page", () => {
  it("renders the project name and the five pipeline steps", async () => {
    render(await Home());
    expect(
      screen.getByRole("heading", { level: 1, name: "SandBag" }),
    ).toBeInTheDocument();
    const steps = screen.getAllByRole("list")[0];
    expect(within(steps!).getAllByRole("listitem")).toHaveLength(5);
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(screen.queryByText("Featured boulders")).toBeNull();
  });

  it("states the open-data values and mounts the hero visual", async () => {
    const { container } = render(await Home());
    expect(
      screen.getByRole("heading", { name: "Open by design" }),
    ).toBeInTheDocument();
    expect(container.querySelector("[data-slot='hero-visual']")).not.toBeNull();
  });

  it("links the contribute CTA to upload", async () => {
    render(await Home());
    expect(
      screen.getByRole("link", { name: /upload a scan/i }),
    ).toHaveAttribute("href", "/upload");
  });

  it("shows featured published boulders when there are any", async () => {
    loadFeatured.mockResolvedValue([
      { id: "s1", thumbPath: null, climbNames: ["Moon"], grades: ["V4"] },
    ]);
    render(await Home());
    expect(
      screen.getByRole("heading", { name: "Featured boulders" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /moon/i })).toHaveAttribute(
      "href",
      "/boulder/s1",
    );
  });

  it("still renders when loading featured boulders fails", async () => {
    loadFeatured.mockRejectedValue(new Error("db down"));
    render(await Home());
    expect(
      screen.getByRole("heading", { level: 1, name: "SandBag" }),
    ).toBeInTheDocument();
  });
});
