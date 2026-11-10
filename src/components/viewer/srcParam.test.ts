import { DEFAULT_VIEWER_SRC, parseViewerSrc } from "./srcParam";

describe("parseViewerSrc", () => {
  it("accepts root-relative paths and http(s) URLs", () => {
    expect(parseViewerSrc(DEFAULT_VIEWER_SRC)).toBe(DEFAULT_VIEWER_SRC);
    expect(parseViewerSrc("  /scans/a.glb ")).toBe("/scans/a.glb");
    expect(
      parseViewerSrc("https://xyz.supabase.co/storage/v1/object/public/m.glb"),
    ).toBe("https://xyz.supabase.co/storage/v1/object/public/m.glb");
    expect(parseViewerSrc("http://localhost:3000/x.glb")).toBe(
      "http://localhost:3000/x.glb",
    );
  });

  it("rejects dangerous or ambiguous values", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:model/gltf-binary;base64,AAAA",
      "//evil.example/x.glb",
      "ftp://host/x.glb",
      "relative/path.glb",
      "",
      "   ",
      undefined,
      null,
      42,
      ["/a.glb"],
    ]) {
      expect(parseViewerSrc(bad)).toBeNull();
    }
  });
});
