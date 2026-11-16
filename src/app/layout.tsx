import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { siteUrl } from "@/lib/siteUrl";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});
const body = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: "SandBag — open 3D boulder visualizer",
  description:
    "Scan boulders, upload the renders, annotate holds and lines in 3D. Open code (AGPL-3.0), open data (CC BY-SA 4.0).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh">
        <a
          href="#main-content"
          className="bg-moss text-on-moss sr-only z-50 rounded-md px-4 py-2 font-semibold focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <SiteHeader />
        {/* Focus target for the skip link; pages keep their own <main>. */}
        <div id="main-content" tabIndex={-1} className="outline-none">
          {children}
        </div>
        <SiteFooter />
      </body>
    </html>
  );
}
