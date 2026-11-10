import { fireEvent, render, screen, within } from "@testing-library/react";
import { demoBoulder } from "@/lib/fixtures";
import type { Climb } from "@/lib/types";
import { ClimbExplorer } from "./ClimbExplorer";
import { parseClimbParam } from "./ClimbPanel";

// No WebGL in jsdom: stand in for the lazily loaded 3D viewer and expose what
// it was told to render, plus a "click a hold" hook.
vi.mock("next/dynamic", () => ({
  default: () =>
    function FakeViewer(props: {
      selectedClimbId: string | null;
      onSelectClimb: (id: string) => void;
    }) {
      return (
        <button
          data-testid="viewer"
          data-selected={props.selectedClimbId ?? ""}
          onClick={() => props.onSelectClimb(demoBoulder.climbs[1]?.id ?? "")}
        >
          fake canvas
        </button>
      );
    },
}));

const [arete, slab] = demoBoulder.climbs as [Climb, Climb];

function renderExplorer(initialClimbId?: string) {
  return render(
    <ClimbExplorer
      src={demoBoulder.scan.public_url}
      label="demo"
      climbs={demoBoulder.climbs}
      holds={demoBoulder.holds}
      paths={demoBoulder.paths}
      initialClimbId={initialClimbId}
    />,
  );
}

const climbButton = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => window.history.replaceState(null, "", "/dev/viewer"));

describe("ClimbExplorer", () => {
  it("lists both climbs with grades, none selected by default", () => {
    renderExplorer();
    const list = screen.getByRole("region", { name: "Climbs" });
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(climbButton(/Demo Arete V2/)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(climbButton(/Sandbagged Slab V4/)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText(/Select a climb/)).toBeInTheDocument();
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-selected", "");
  });

  it("selecting a climb shows its info, tells the viewer, and updates the URL", () => {
    renderExplorer();
    fireEvent.click(climbButton(/Demo Arete/));
    expect(climbButton(/Demo Arete/)).toHaveAttribute("aria-pressed", "true");
    const info = screen.getByRole("region", { name: /Demo Arete/ });
    expect(info).toHaveTextContent(arete.description);
    expect(info).toHaveTextContent("V2");
    expect(info).toHaveTextContent(/Start: \d+/);
    expect(screen.getByTestId("viewer")).toHaveAttribute(
      "data-selected",
      arete.id,
    );
    expect(new URL(window.location.href).searchParams.get("climb")).toBe(
      arete.id,
    );
  });

  it("switches selection, and pressing the selected climb clears it", () => {
    renderExplorer(arete.id);
    expect(climbButton(/Demo Arete/)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(climbButton(/Sandbagged Slab/));
    expect(climbButton(/Demo Arete/)).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("region", { name: /Sandbagged Slab/ }),
    ).toBeVisible();
    fireEvent.click(climbButton(/Sandbagged Slab/));
    expect(screen.getByText(/Select a climb/)).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("is keyboard reachable: native buttons in tab order", () => {
    renderExplorer();
    const btn = climbButton(/Demo Arete/);
    btn.focus();
    expect(btn).toHaveFocus();
    expect(btn).toHaveAttribute("type", "button");
  });

  it("clicking a hold in the viewer selects its climb", () => {
    renderExplorer();
    fireEvent.click(screen.getByTestId("viewer"));
    expect(climbButton(/Sandbagged Slab/)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("ignores an unknown ?climb= value", () => {
    renderExplorer("not-a-climb");
    expect(screen.getByText(/Select a climb/)).toBeInTheDocument();
  });
});

describe("parseClimbParam", () => {
  it("accepts only known ids", () => {
    expect(parseClimbParam(slab.id, demoBoulder.climbs)).toBe(slab.id);
    expect(parseClimbParam("x", demoBoulder.climbs)).toBeNull();
    expect(parseClimbParam(undefined, demoBoulder.climbs)).toBeNull();
  });
});
