import { render, screen, within } from "@testing-library/react";
import { SiteFooter } from "./SiteFooter";
import { NAV_LINKS, SiteHeader } from "./SiteHeader";

describe("SiteHeader", () => {
  it("has a wordmark home link and the main nav", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "SandBag" })).toHaveAttribute(
      "href",
      "/",
    );
    const nav = screen.getByRole("navigation", { name: "Main" });
    // Each link appears twice: inline on wide screens, and in the phone menu.
    for (const { href, label } of NAV_LINKS) {
      const links = within(nav).getAllByRole("link", { name: label });
      expect(links).toHaveLength(2);
      for (const l of links) expect(l).toHaveAttribute("href", href);
    }
  });

  it("has Home and FAQ in the nav", () => {
    expect(NAV_LINKS.map((l) => l.label)).toEqual(
      expect.arrayContaining(["Home", "FAQ"]),
    );
    expect(NAV_LINKS[0]).toEqual({ href: "/", label: "Home" });
  });

  it("offers the phone menu as a native disclosure (no JavaScript needed)", () => {
    const { container } = render(<SiteHeader />);
    const menu = container.querySelector("details");
    expect(menu).not.toBeNull();
    expect(menu!.querySelector("summary")!.textContent).toContain("Menu");
    expect(menu!.className).toContain("sm:hidden");
  });

  it("keeps the static account link (proxy redirects signed-out users)", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute(
      "href",
      "/account",
    );
  });
});

describe("SiteFooter", () => {
  it("credits OpenBeta and states the licences", () => {
    render(<SiteFooter />);
    expect(screen.getByRole("link", { name: /openbeta/i })).toHaveAttribute(
      "href",
      "https://openbeta.io",
    );
    expect(screen.getByText("Code: AGPL-3.0")).toBeInTheDocument();
    expect(screen.getByText("Data: CC BY-SA 4.0")).toBeInTheDocument();
  });
});
