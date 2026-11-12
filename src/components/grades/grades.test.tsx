import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { voteFailureHelp } from "@/lib/grades/voteFailure";
import { applyVote, GradeVotes } from "./GradeVotes";

describe("applyVote", () => {
  it("adds a new vote and moves a changed one", () => {
    expect(applyVote({ V3: 1 }, null, "V4")).toEqual({ V3: 1, V4: 1 });
    expect(applyVote({ V3: 1, V4: 1 }, "V3", "V5")).toEqual({
      V3: 0,
      V4: 1,
      V5: 1,
    });
  });
});

describe("GradeVotes", () => {
  it("shows consensus and the sandbag badge", () => {
    render(<GradeVotes proposedGrade="V3" distribution={{ V5: 3, V3: 1 }} />);
    expect(screen.getByText("Sandbagged by 2 grades")).toBeInTheDocument();
    expect(screen.getByText("3 votes")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("has no badge below the vote threshold", () => {
    render(<GradeVotes proposedGrade="V3" distribution={{ V8: 2 }} />);
    expect(screen.queryByText(/Sandbagged/)).toBeNull();
    expect(screen.getByText("needs more votes")).toBeInTheDocument();
  });

  it("votes optimistically and calls onVote", async () => {
    const onVote = vi.fn().mockResolvedValue(undefined);
    render(<GradeVotes proposedGrade="V3" distribution={{}} onVote={onVote} />);
    fireEvent.click(screen.getByRole("radio", { name: "V4" }));
    expect(onVote).toHaveBeenCalledWith("V4");
    expect(screen.getByText("1 vote")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "V4" })).toBeChecked(),
    );
  });

  it("shows the server's reason, step, advice and report link, and rolls back", async () => {
    const onVote = vi.fn().mockResolvedValue({
      ok: false,
      help: voteFailureHelp("error", {
        reference: "SB-0123ABCD",
        reportPath: "/report-problem?ref=SB-0123ABCD",
      }),
    });
    render(<GradeVotes proposedGrade="V3" distribution={{}} onVote={onVote} />);
    fireEvent.click(screen.getByRole("radio", { name: "V4" }));
    await screen.findByText(/something went wrong on our side/);
    expect(screen.getByText(/Saving your vote/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Report this problem" }),
    ).toHaveAttribute("href", "/report-problem?ref=SB-0123ABCD");
    expect(screen.getByRole("radio", { name: "V4" })).not.toBeChecked();
  });

  it("explains a sign-in problem without a report link", async () => {
    const onVote = vi
      .fn()
      .mockResolvedValue({ ok: false, help: voteFailureHelp("signed_out") });
    render(<GradeVotes proposedGrade="V3" distribution={{}} onVote={onVote} />);
    fireEvent.click(screen.getByRole("radio", { name: "V4" }));
    await screen.findByText(/sign-in expired/);
    expect(
      screen.queryByRole("link", { name: "Report this problem" }),
    ).toBeNull();
  });

  it("rolls back and explains when saving throws", async () => {
    const onVote = vi.fn().mockRejectedValue(new Error("x"));
    render(<GradeVotes proposedGrade="V3" distribution={{}} onVote={onVote} />);
    fireEvent.click(screen.getByRole("radio", { name: "V4" }));
    await screen.findByText(/Your vote wasn't saved/);
    expect(screen.getByText(/What you can do/)).toBeInTheDocument();
    expect(screen.getByText("No grade votes yet.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "V4" })).not.toBeChecked();
  });
});
