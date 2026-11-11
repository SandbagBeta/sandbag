import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShareButton } from "./ShareButton";

const original = { share: navigator.share, clipboard: navigator.clipboard };

function stubNavigator(stubs: {
  share?: (data: ShareData) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}) {
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: stubs.share,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: stubs.writeText ? { writeText: stubs.writeText } : undefined,
  });
}

beforeEach(() =>
  window.history.replaceState(null, "", "/boulder/abc?climb=c1"),
);
afterEach(() => {
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: original.share,
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: original.clipboard,
  });
});

const button = () => screen.getByRole("button", { name: "Share link" });

describe("ShareButton", () => {
  it("uses the native share sheet with the current URL, including ?climb=", async () => {
    const share = vi.fn(async () => {});
    stubNavigator({ share });
    render(<ShareButton title="Split Rock" />);
    fireEvent.click(button());
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        title: "Split Rock",
        url: "http://localhost:3000/boulder/abc?climb=c1",
      }),
    );
  });

  it("falls back to copying the link and says so", async () => {
    const writeText = vi.fn(async () => {});
    stubNavigator({ writeText });
    render(<ShareButton title="x" />);
    fireEvent.click(button());
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(
      "http://localhost:3000/boulder/abc?climb=c1",
    );
  });

  it("stays quiet when the user closes the share sheet", async () => {
    const share = vi.fn(async () => {
      throw new DOMException("cancelled", "AbortError");
    });
    stubNavigator({ share });
    render(<ShareButton title="x" />);
    fireEvent.click(button());
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(screen.queryByText(/Could not copy/)).not.toBeInTheDocument();
  });

  it("tells the user when copying fails", async () => {
    stubNavigator({
      writeText: async () => {
        throw new Error("denied");
      },
    });
    render(<ShareButton title="x" />);
    fireEvent.click(button());
    expect(await screen.findByText(/Could not copy/)).toBeInTheDocument();
  });
});
