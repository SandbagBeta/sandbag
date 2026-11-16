import { fireEvent, render, screen } from "@testing-library/react";
import { AreaTree } from "./AreaTree";
import { BoulderCards, climbSummary } from "./BoulderCards";
import { SearchEmpty } from "./SearchEmpty";
import { EmptyState } from "@/components/site/EmptyState";
import { CardGridSkeleton, LoadingShell } from "@/components/site/Skeleton";

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
    expect(links[0]!.querySelector("[data-thumb]")).toHaveAttribute(
      "data-thumb",
      "image",
    );
    // No thumbnail path: placeholder from the start, no <img>.
    expect(links[1]!.querySelector("img")).toBeNull();
    expect(links[1]!.querySelector("[data-thumb]")).toHaveAttribute(
      "data-thumb",
      "placeholder",
    );
    // A thumbnail that fails to load falls back to the placeholder tile.
    fireEvent.error(img!);
    expect(links[0]!.querySelector("img")).toBeNull();
    expect(links[0]!.querySelector("[data-thumb]")).toHaveAttribute(
      "data-thumb",
      "placeholder",
    );
  });

  it("summarizes a single grade and no climbs", () => {
    expect(climbSummary({ climbNames: ["A"], grades: ["V3"] })).toBe(
      "1 climb · V3",
    );
    expect(climbSummary({ climbNames: [], grades: [] })).toBe("No climbs yet");
  });
});

describe("empty and loading states", () => {
  it("offers next steps when a search matches nothing", () => {
    render(<SearchEmpty kind="none" />);
    expect(
      screen.getByRole("heading", { name: "Nothing published matches" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "browse by area" }),
    ).toHaveAttribute("href", "/areas");
  });

  it("prompts for a query before any search", () => {
    render(<SearchEmpty kind="idle" />);
    expect(
      screen.getByRole("heading", { name: "Find a boulder" }),
    ).toBeInTheDocument();
  });

  it("renders actions and can be the page h1", () => {
    render(
      <EmptyState
        title="Nothing here"
        headingLevel="h1"
        actions={<a href="/x">Go</a>}
      >
        Help text
      </EmptyState>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Nothing here" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go" })).toBeInTheDocument();
  });

  it("announces loading once and hides skeleton blocks from assistive tech", () => {
    const { container } = render(
      <LoadingShell label="Loading areas">
        <CardGridSkeleton count={2} />
      </LoadingShell>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading areas");
    const blocks = container.querySelectorAll(".skeleton");
    expect(blocks.length).toBeGreaterThan(0);
    blocks.forEach((b) => expect(b).toHaveAttribute("aria-hidden", "true"));
  });
});
