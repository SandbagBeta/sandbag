import { siteUrl } from "./siteUrl";

describe("siteUrl", () => {
  it("prefers an explicit SITE_URL, reduced to its origin", () => {
    expect(
      siteUrl({ SITE_URL: "https://sandbag.example/some/path" }).href,
    ).toBe("https://sandbag.example/");
  });

  it("uses the production domain on Vercel production", () => {
    expect(
      siteUrl({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "sandbag.vercel.app",
        VERCEL_URL: "sandbag-abc123.vercel.app",
      }).href,
    ).toBe("https://sandbag.vercel.app/");
  });

  it("uses the deployment URL on previews, so preview links stay on the preview", () => {
    expect(
      siteUrl({
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_PRODUCTION_URL: "sandbag.vercel.app",
        VERCEL_URL: "sandbag-abc123.vercel.app",
      }).href,
    ).toBe("https://sandbag-abc123.vercel.app/");
  });

  it("falls back to localhost on the configured port", () => {
    expect(siteUrl({}).href).toBe("http://localhost:3000/");
    expect(siteUrl({ PORT: "3012" }).href).toBe("http://localhost:3012/");
  });

  it("ignores unusable values", () => {
    expect(siteUrl({ SITE_URL: "javascript:alert(1)" }).href).toBe(
      "http://localhost:3000/",
    );
  });
});
