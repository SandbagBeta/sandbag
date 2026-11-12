import type { NextConfig } from "next";
import { parseDevOrigins } from "./src/lib/devOrigins";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Enables forbidden() so non-reviewers get a real 403 on /review.
  experimental: { authInterrupts: true },
  // Lets phones on the LAN load dev-only resources from `pnpm dev -H 0.0.0.0`.
  // Set DEV_ALLOWED_ORIGINS in .env.local; see .env.example.
  allowedDevOrigins: parseDevOrigins(process.env.DEV_ALLOWED_ORIGINS),
  // Self-hosted Draco decoder (copied by scripts/copy-draco.mjs): long-lived
  // immutable caching, and .wasm must be served as application/wasm.
  async headers() {
    return [
      {
        source: "/draco/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/draco/:path*.wasm",
        headers: [{ key: "Content-Type", value: "application/wasm" }],
      },
    ];
  },
};

export default nextConfig;
