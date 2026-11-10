import { fireEvent, render, screen } from "@testing-library/react";
import { describeError, ViewerErrorBoundary } from "./ViewerErrorBoundary";

function Thrower({ error }: { error: Error | null }) {
  if (error) throw error;
  return <p>scan loaded</p>;
}

describe("ViewerErrorBoundary", () => {
  beforeEach(() => {
    // React logs caught errors; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders a readable message instead of crashing", () => {
    render(
      <ViewerErrorBoundary>
        <Thrower error={new Error("fetch for /x.glb responded with 404")} />
      </ViewerErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't load this scan",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("not found (404)");
  });

  it("retry calls onRetry and re-renders the children", () => {
    const onRetry = vi.fn();
    let error: Error | null = new Error("boom");
    const { rerender } = render(
      <ViewerErrorBoundary onRetry={onRetry}>
        <Thrower error={error} />
      </ViewerErrorBoundary>,
    );
    error = null;
    rerender(
      <ViewerErrorBoundary onRetry={onRetry}>
        <Thrower error={error} />
      </ViewerErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("scan loaded")).toBeInTheDocument();
  });
});

describe("describeError", () => {
  it("classifies common loader failures", () => {
    expect(describeError(new Error("Could not load: 404"))).toMatch(/404/);
    expect(describeError(new Error("Failed to fetch"))).toMatch(/Network/);
    expect(describeError(new Error("Unexpected token in JSON"))).toMatch(
      /valid GLB/,
    );
    expect(describeError(new Error(""))).toBe("Unknown error.");
  });
});
