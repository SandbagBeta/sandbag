import { render, screen } from "@testing-library/react";
import Home from "./page";

describe("Home page", () => {
  it("renders the project name and the five pipeline steps", () => {
    render(<Home />);
    expect(
      screen.getByRole("heading", { level: 1, name: "SandBag" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  it("links to sign-in / account", () => {
    render(<Home />);
    expect(
      screen.getByRole("link", { name: /sign in \/ account/i }),
    ).toHaveAttribute("href", "/account");
  });

  it("links to the OpenBeta project it builds on", () => {
    render(<Home />);
    expect(screen.getByRole("link", { name: /openbeta/i })).toHaveAttribute(
      "href",
      "https://openbeta.io",
    );
  });
});
