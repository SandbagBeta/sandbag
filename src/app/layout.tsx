import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "SandBag — open 3D boulder visualizer",
  description:
    "Scan boulders, upload the renders, annotate holds and lines in 3D. Open code (AGPL-3.0), open data (CC BY-SA 4.0).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
