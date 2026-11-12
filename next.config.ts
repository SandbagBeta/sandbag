import type { NextConfig } from "next";
import { parseDevOrigins } from "./src/lib/devOrigins";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // QC loads wasm by file path at runtime (draco3dgltf reads its .wasm next to
  // its JS). Bundling rewrites that path and the read fails (#119), so keep
  // these as plain node_modules requires and make sure the files are traced
  // into the deploy. sharp is native and external by default; listed so that
  // stays true.
  serverExternalPackages: ["draco3dgltf", "sharp"],
  outputFileTracingIncludes: {
    "/api/qc/run": ["./node_modules/draco3dgltf/*.wasm"],
  },
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
