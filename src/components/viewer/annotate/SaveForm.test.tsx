import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SaveForm, type SaveFormProps } from "./SaveForm";

const save = vi.fn();
const push = vi.fn();
vi.mock("@/app/annotate/actions", () => ({
  saveClimb: (p: unknown) => save(p),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

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
    ...over,
  };
  render(<SaveForm {...props} />);
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

  it("shows validation issues and selects the flagged hold", async () => {
    save.mockResolvedValue({
      ok: false,
      code: "validation",
      message: "bad",
      issues: [
        { code: "off_surface", message: "Hold is off the rock.", holdId: "h9" },
      ],
    });
    const p = setup();
    click();
    await screen.findByText(/Hold is off the rock/);
    expect(p.onSelect).toHaveBeenCalledWith("h9");
    expect(push).not.toHaveBeenCalled();
  });

  it("offers reload when stale", async () => {
    save.mockResolvedValue({ ok: false, code: "stale", message: "x" });
    setup();
    click();
    await screen.findByRole("button", { name: "Reload the scan" });
  });

  it("links to sign-in when signed out", async () => {
    save.mockResolvedValue({ ok: false, code: "signed_out", message: "x" });
    setup();
    click();
    const a = await screen.findByRole("link", { name: "Sign in" });
    expect(a.getAttribute("href")).toContain("/sign-in?next=");
  });

  it("maps a thrown action to a retryable error", async () => {
    save.mockRejectedValue(new Error("network"));
    setup();
    click();
    await screen.findByText(/Something went wrong/);
  });
});
