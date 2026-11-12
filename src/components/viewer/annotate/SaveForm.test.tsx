import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SaveFailureView } from "@/lib/annotations/savePayload";
import type { FailureHelp } from "@/lib/annotations/failureHelp";
import type { Hold } from "@/lib/types";
import { SaveFailureAlert } from "./SaveFailureAlert";
import { SaveForm, type SaveFormProps } from "./SaveForm";

const save = vi.fn();
const push = vi.fn();
vi.mock("@/app/annotate/actions", () => ({
  saveClimb: (p: unknown) => save(p),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const help = (over: Partial<FailureHelp> = {}): FailureHelp => ({
  stage: "validation",
  stageLabel: "Checking your holds and lines",
  userFixable: true,
  whatHappened: "Your climb wasn't saved: some holds need fixing.",
  whatYouCanDo: ["Fix the holds."],
  nextSteps: [],
  ...over,
});

const hold = (id: string, i: number): Hold => ({
  id,
  climb_id: "draft",
  scan_content_hash: "h",
  position: [0, 0, 0],
  normal: [0, 1, 0],
  face_index: i,
  type: i === 0 ? "start" : "hand",
  seq_order: i,
});

// The editor shows the failure beside the form; mirror that wiring here.
function Harness(props: SaveFormProps) {
  const [failure, setFailure] = useState<SaveFailureView | null>(null);
  return (
    <>
      <SaveFailureAlert failure={failure} onSelect={props.onSelect} />
      <SaveForm {...props} onFailure={setFailure} />
    </>
  );
}

function setup(over: Partial<SaveFormProps> = {}) {
  const props: SaveFormProps = {
    scanId: "s1",
    scanContentHash: "h",
    holds: [],
    paths: [],
    meta: {
      name: "A",
      description: "",
      proposed_grade: "V3",
      fa_info: "",
    },
    onMeta: vi.fn(),
    onSelect: vi.fn(),
    onFailure: vi.fn(),
    ...over,
  };
  render(<Harness {...props} />);
  return props;
}

const click = () =>
  fireEvent.click(screen.getByRole("button", { name: /Save climb/ }));

describe("SaveForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks save without a grade", () => {
    setup({
      meta: { name: "A", description: "", proposed_grade: "", fa_info: "" },
    });
    click();
    expect(screen.getByText("Choose a proposed grade.")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("redirects on success", async () => {
    save.mockResolvedValue({ ok: true, climbId: "c1" });
    setup();
    click();
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/boulder/s1?submitted=1"),
    );
  });

  it("editing: sends the climb id, says Save changes, and returns with updated=1", async () => {
    save.mockResolvedValue({ ok: true, climbId: "c1" });
    setup({ climbId: "c1" });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/boulder/s1?updated=1"),
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ climbId: "c1", scanId: "s1" }),
    );
  });

  it("names holds by number and selects the flagged hold", async () => {
    save.mockResolvedValue({
      ok: false,
      code: "validation",
      message: "bad",
      help: help(),
      issues: [
        { code: "off_surface", message: "Hold abc is 0.2 m off", holdId: "h2" },
      ],
    });
    const p = setup({ holds: [hold("h1", 0), hold("h2", 1)] });
    click();
    await screen.findByText(/Hold 2 is too far from the rock surface/);
    expect(screen.queryByText(/0\.2 m|h2/)).toBeNull();
    expect(p.onSelect).toHaveBeenCalledWith("h2");
    fireEvent.click(screen.getByRole("button", { name: "Select hold" }));
    expect(p.onSelect).toHaveBeenCalledTimes(2);
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the help, and says the work is kept in the browser", async () => {
    save.mockResolvedValue({
      ok: false,
      code: "stale",
      message: "x",
      help: help({
        stage: "mesh",
        stageLabel: "Reading the 3D model",
        whatHappened: "Your climb wasn't saved: the 3D model changed.",
        whatYouCanDo: ["Reload this page."],
        nextSteps: ["Press Save once the holds are placed."],
      }),
    });
    setup();
    click();
    await screen.findByText("Reading the 3D model");
    expect(screen.getByText(/the 3D model changed/)).toBeTruthy();
    expect(screen.getByText("Reload this page.")).toBeTruthy();
    expect(screen.getByText(/Press Save once/)).toBeTruthy();
    expect(screen.getByText(/kept in this browser/)).toBeTruthy();
    expect(screen.queryByText(/Reference/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Reload the scan" }),
    ).toBeTruthy();
  });

  it("shows the reference and a report link when it was logged", async () => {
    save.mockResolvedValue({
      ok: false,
      code: "error",
      message: "x",
      help: help({
        stage: "database",
        userFixable: false,
        whatHappened: "Your climb wasn't saved: something went wrong.",
        whatYouCanDo: ["Press Save again."],
        reference: "SB-ABCD2345",
        reportPath: "/report-problem?ref=SB-ABCD2345",
      }),
    });
    setup();
    click();
    await screen.findByText("SB-ABCD2345");
    const a = screen.getByRole("link", { name: /Report this problem/ });
    expect(a.getAttribute("href")).toBe("/report-problem?ref=SB-ABCD2345");
  });

  it("does not link to a report path that isn't ours", async () => {
    save.mockResolvedValue({
      ok: false,
      code: "error",
      message: "x",
      help: help({
        userFixable: false,
        reference: "SB-ABCD2345",
        reportPath: "https://evil.example/",
      }),
    });
    setup();
    click();
    await screen.findByText("SB-ABCD2345");
    expect(screen.queryByRole("link", { name: /Report/ })).toBeNull();
  });

  it("links to sign-in when signed out", async () => {
    save.mockResolvedValue({
      ok: false,
      code: "signed_out",
      message: "x",
      help: help({ stage: "session" }),
    });
    setup();
    click();
    const a = await screen.findByRole("link", { name: "Sign in" });
    expect(a.getAttribute("href")).toContain("/sign-in?next=");
  });

  it("maps a thrown action to a retryable, user-fixable error", async () => {
    save.mockRejectedValue(new Error("network"));
    setup();
    click();
    await screen.findByText(/couldn't reach the server/);
    expect(screen.getByText(/press Save again/)).toBeTruthy();
    expect(screen.queryByText(/Reference/)).toBeNull();
  });
});
