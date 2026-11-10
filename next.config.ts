import type { NextConfig } from "next";
import { parseDevOrigins } from "./src/lib/devOrigins";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lets phones on the LAN load dev-only resources from `pnpm dev -H 0.0.0.0`.
  // Set DEV_ALLOWED_ORIGINS in .env.local; see .env.example.
  allowedDevOrigins: parseDevOrigins(process.env.DEV_ALLOWED_ORIGINS),
};

export default nextConfig;
