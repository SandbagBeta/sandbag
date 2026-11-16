import { render, screen } from "@testing-library/react";
import { ClimbsSection, UploadsSection, VotesSection } from "./Dashboard";
import { PublicProfileView } from "./PublicProfileView";
import { StepTracker } from "./StepTracker";
import { trackerSteps } from "@/lib/scan-report/tracker";

describe("dashboard empty states", () => {
  it("each section explains itself and offers a next step", () => {
    render(
      <>
        <UploadsSection uploads={[]} thumbs={{}} />
        <ClimbsSection climbs={[]} />
        <VotesSection votes={[]} />
      </>,
    );
    expect(
      screen.getByRole("heading", { name: "No uploads yet" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload a scan" })).toHaveAttribute(
      "href",
      "/upload",
    );
    expect(
      screen.getByRole("heading", { name: "No climbs yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "No grade votes yet" }),
    ).toBeInTheDocument();
  });
});

describe("UploadsSection", () => {
  it("shows the step state, reason and details link", () => {
    render(
      <UploadsSection
        thumbs={{ s1: null }}
        uploads={[
          {
            id: "s1",
            status: "failed_qc",
            createdAt: "2026-05-02T00:00:00Z",
            steps: trackerSteps("failed_qc"),
            reason: "Too few triangles.",
            thumb: null,
          },
        ]}
      />,
    );
    expect(screen.getByText(/Too few triangles/)).toBeInTheDocument();
    expect(screen.getByText("Failed checks")).toBeInTheDocument();
    expect(screen.getByText("(needs attention)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Details" })).toHaveAttribute(
      "href",
      "/upload/scans/s1",
    );
    expect(document.querySelector('[data-thumb="placeholder"]')).not.toBeNull();
  });
});

describe("ClimbsSection", () => {
  it("offers Edit only on pending climbs", () => {
    const base = { grade: "V3", scanId: "s", boulderHref: "/boulder/s" };
    render(
      <ClimbsSection
        climbs={[
          {
            ...base,
            id: "1",
            name: "Pub",
            status: "published",
            climbHref: "/climb/1",
            editHref: null,
          },
          {
            ...base,
            id: "2",
            name: "Pend",
            status: "pending_review",
            climbHref: null,
            editHref: "/boulder/s/annotate?climb=2",
          },
        ]}
      />,
    );
    expect(screen.getAllByRole("link", { name: "Edit" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Climb" })).toHaveLength(1);
  });
});

describe("StepTracker", () => {
  it("marks the current step for assistive tech", () => {
    render(<StepTracker steps={trackerSteps("processing")} />);
    expect(screen.getByText("Checking").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
  });
});

describe("PublicProfileView", () => {
  it("shows handle, member since and an empty state", () => {
    render(
      <PublicProfileView
        supabaseUrl="http://127.0.0.1:54321"
        profile={{
          handle: "alex",
          memberSince: "2026-03-05T10:00:00Z",
          boulders: [],
          climbs: [],
        }}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "@alex" }),
    ).toBeInTheDocument();
    expect(screen.getByText("March 2026")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Nothing published yet" }),
    ).toBeInTheDocument();
  });
  it("lists published climbs and scans", () => {
    render(
      <PublicProfileView
        supabaseUrl="http://127.0.0.1:54321"
        profile={{
          handle: "alex",
          memberSince: "2026-03-05T10:00:00Z",
          boulders: [
            { id: "s1", thumbPath: null, climbNames: ["Mine"], grades: ["V3"] },
          ],
          climbs: [{ id: "c1", name: "Mine", grade: "V3", scanId: "s1" }],
        }}
      />,
    );
    expect(screen.getByRole("link", { name: /Mine\s*V3/ })).toBeTruthy();
    expect(
      screen
        .getAllByRole("link")
        .some((l) => l.getAttribute("href") === "/boulder/s1"),
    ).toBe(true);
  });
});
