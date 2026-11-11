import { render, screen } from "@testing-library/react";
import { ExportLink } from "./ExportLink";

test("links to the scan export route as a download", () => {
  render(<ExportLink scanId="abc-123" />);
  const a = screen.getByRole("link", { name: /download open data/i });
  expect(a).toHaveAttribute("href", "/api/scans/abc-123/export");
  expect(a).toHaveAttribute("download", "sandbag-abc-123.zip");
});
