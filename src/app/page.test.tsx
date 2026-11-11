import { render, screen } from "@testing-library/react";
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
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByText("Featured boulders")).toBeNull();
  });

  it("links to sign-in / account", async () => {
    render(await Home());
    expect(
      screen.getByRole("link", { name: /sign in \/ account/i }),
    ).toHaveAttribute("href", "/account");
  });

  it("links to the OpenBeta project it builds on", async () => {
    render(await Home());
    expect(screen.getByRole("link", { name: /openbeta/i })).toHaveAttribute(
      "href",
      "https://openbeta.io",
    );
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
