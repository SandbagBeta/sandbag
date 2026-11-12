import { render, screen } from "@testing-library/react";
import { editDeniedHelp } from "@/lib/annotations/editClimb";
import { EditDenied } from "./EditDenied";

describe("EditDenied", () => {
  it("shows what happened, the step, what you can do and next steps", () => {
    render(
      <EditDenied
        help={editDeniedHelp("not_author")}
        boulderHref="/boulder/s1"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /only the person who created it/,
    );
    expect(screen.getByText(/Step:/)).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "What you can do" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Next steps" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to the boulder" }),
    ).toHaveAttribute("href", "/boulder/s1");
  });
});
