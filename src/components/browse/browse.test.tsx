import { fireEvent, render, screen } from "@testing-library/react";
import { AreaTree } from "./AreaTree";
import { BoulderCards, climbSummary } from "./BoulderCards";

describe("AreaTree", () => {
  it("links each area with its scan count, nested", () => {
    render(
      <AreaTree
        nodes={[
          {
            id: "a",
            name: "New Hampshire",
            scanCount: 3,
            children: [
              { id: "b", name: "Pawtuckaway", scanCount: 1, children: [] },
            ],
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("link", { name: /New Hampshire 3 scans/ }),
    ).toHaveAttribute("href", "/area/a");
    expect(
      screen.getByRole("link", { name: /Pawtuckaway 1 scan$/ }),
    ).toHaveAttribute("href", "/area/b");
  });
});

describe("BoulderCards", () => {
  it("links to the boulder page and summarizes climbs", () => {
    render(
      <BoulderCards
        supabaseUrl="http://127.0.0.1:54321"
        boulders={[
          {
            id: "s1",
            thumbPath: "s1/h.webp",
            climbNames: ["Arete", "Slab"],
            grades: ["V2", "V4"],
          },
          { id: "s2", thumbPath: null, climbNames: [], grades: [] },
        ]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/boulder/s1");
    expect(links[0]).toHaveTextContent("Arete, Slab");
    expect(links[0]).toHaveTextContent("2 climbs · V2–V4");
    expect(links[1]).toHaveTextContent("Boulder scan");
    const img = links[0]!.querySelector("img");
    expect(img).toHaveAttribute(
      "src",
      "http://127.0.0.1:54321/storage/v1/object/public/published/s1/h.webp",
    );
    // A missing thumbnail falls back to the placeholder tile.
    fireEvent.error(img!);
    expect(links[0]!.querySelector("img")).toBeNull();
  });

  it("summarizes a single grade and no climbs", () => {
    expect(climbSummary({ climbNames: ["A"], grades: ["V3"] })).toBe(
      "1 climb · V3",
    );
    expect(climbSummary({ climbNames: [], grades: [] })).toBe("No climbs yet");
  });
});
