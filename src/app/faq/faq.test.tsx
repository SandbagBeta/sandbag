import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FaqPage from "./page";
import { FAQ_SECTIONS, faqJsonLd } from "./faq";

describe("FAQ content", () => {
  it("covers the four agreed topics with unique anchors", () => {
    expect(FAQ_SECTIONS.map((s) => s.id)).toEqual([
      "scanning",
      "review",
      "access",
      "licensing",
    ]);
    expect(new Set(FAQ_SECTIONS.map((s) => s.id)).size).toBe(4);
  });

  it("has a question and at least one answer paragraph everywhere", () => {
    for (const s of FAQ_SECTIONS) {
      expect(s.items.length).toBeGreaterThan(0);
      for (const i of s.items) {
        expect(i.q.trim().endsWith("?")).toBe(true);
        expect(i.a.length).toBeGreaterThan(0);
        for (const p of i.a) expect(p.trim()).not.toBe("");
      }
    }
  });

  it("never states a precise coordinate or an email", () => {
    const all = JSON.stringify(FAQ_SECTIONS);
    expect(all).not.toMatch(/-?\d{1,3}\.\d{4,}/);
    expect(all).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
  });
});

describe("faqJsonLd", () => {
  it("is valid FAQPage JSON with every question", () => {
    const data = JSON.parse(faqJsonLd());
    expect(data["@type"]).toBe("FAQPage");
    const total = FAQ_SECTIONS.reduce((n, s) => n + s.items.length, 0);
    expect(data.mainEntity).toHaveLength(total);
  });

  it("escapes < so text can never close the script element", () => {
    const out = faqJsonLd([
      {
        id: "x",
        title: "X",
        items: [{ q: "Q?", a: ["</script><b>"] }],
      },
    ]);
    expect(out).not.toContain("<");
    expect(JSON.parse(out).mainEntity[0].acceptedAnswer.text).toBe(
      "</script><b>",
    );
  });
});

describe("FaqPage", () => {
  it("renders every section as a labelled region with native disclosures", () => {
    const { container } = render(<FaqPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /frequently asked/i }),
    ).toBeInTheDocument();
    for (const s of FAQ_SECTIONS) {
      const region = screen.getByRole("region", { name: s.title });
      expect(region).toHaveAttribute("id", s.id);
      expect(within(region).getAllByText(/\?$/).length).toBeGreaterThan(0);
    }
    expect(container.querySelectorAll("details").length).toBeGreaterThan(10);
  });

  it("turns URLs in answers into links", () => {
    render(<FaqPage />);
    const links = screen.getAllByRole("link", {
      name: /^github\.com\/sandbagbeta\//,
    });
    expect(links.length).toBeGreaterThan(0);
    // The target is checked on the real href, anchored at the start.
    for (const l of links) {
      expect(l.getAttribute("href")).toMatch(
        /^https:\/\/github\.com\/sandbagbeta\//,
      );
    }
  });
});
