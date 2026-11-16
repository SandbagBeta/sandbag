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
    for (const { href, label } of NAV_LINKS) {
      expect(within(nav).getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    }
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
