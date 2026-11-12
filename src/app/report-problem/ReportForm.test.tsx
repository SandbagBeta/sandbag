import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReportForm } from "./ReportForm";

const report = vi.fn();
vi.mock("@/app/annotate/actions", () => ({
  reportSaveFailure: (ref: string, note: string) => report(ref, note),
}));

const send = () =>
  fireEvent.click(screen.getByRole("button", { name: /Send/ }));
const type = (v: string) =>
  fireEvent.change(screen.getByLabelText("What happened?"), {
    target: { value: v },
  });

describe("ReportForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("won't send an empty note", () => {
    render(<ReportForm reference="SB-ABCD2345" />);
    type("   ");
    send();
    expect(report).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/Write a short note/);
  });

  it("limits the note to 1000 characters", () => {
    render(<ReportForm reference="SB-ABCD2345" />);
    expect(
      screen.getByLabelText("What happened?").getAttribute("maxlength"),
    ).toBe("1000");
  });

  it("sends the note with the reference and confirms", async () => {
    report.mockResolvedValue({ ok: true });
    render(<ReportForm reference="SB-ABCD2345" />);
    type("It failed twice");
    send();
    await screen.findByText(/Your note was sent with reference SB-ABCD2345/);
    expect(report).toHaveBeenCalledWith("SB-ABCD2345", "It failed twice");
  });

  it("shows the server's reason when it refuses", async () => {
    report.mockResolvedValue({
      ok: false,
      code: "not_found",
      message: "That reference isn't valid.",
    });
    render(<ReportForm reference="SB-ABCD2345" />);
    type("hi");
    send();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/isn't valid/),
    );
  });

  it("survives a thrown action", async () => {
    report.mockRejectedValue(new Error("net"));
    render(<ReportForm reference="SB-ABCD2345" />);
    type("hi");
    send();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Couldn't send/),
    );
  });
});
