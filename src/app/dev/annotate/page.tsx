import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { demoBoulder } from "@/lib/fixtures";
import { isDevHarnessEnabled } from "../devHarness";
import { AnnotateClient } from "./AnnotateClient";

export const metadata: Metadata = {
  title: "Annotate dev page — SandBag",
  robots: { index: false, follow: false },
};

/** Dev harness for hold placement (#21) on the demo fixture; holds are not saved. */
export default function AnnotateDevPage() {
  if (!isDevHarnessEnabled()) notFound();
  return (
    <main className="relative h-dvh w-full">
      <AnnotateClient
        src={demoBoulder.scan.public_url}
        scanContentHash={demoBoulder.scan.content_hash}
        climbs={demoBoulder.climbs}
        holds={demoBoulder.holds}
        paths={demoBoulder.paths}
      />
    </main>
  );
}
