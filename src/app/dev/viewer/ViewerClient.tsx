"use client";

import dynamic from "next/dynamic";
import { ClimbExplorer } from "@/components/viewer/climbs/ClimbExplorer";
import { demoBoulder } from "@/lib/fixtures";

// The viewer needs WebGL; never render it on the server.
const BoulderViewer = dynamic(
  () =>
    import("@/components/viewer/BoulderViewer").then((m) => m.BoulderViewer),
  { ssr: false },
);

const HELP = "Use mouse or touch to orbit, pan and zoom.";

export function ViewerClient({ src, climb }: { src: string; climb?: string }) {
  // Fixture holds are pinned to the demo GLB; any other ?src= gets no overlay.
  if (src === demoBoulder.scan.public_url) {
    return (
      <ClimbExplorer
        src={src}
        label="3D scan of the demo boulder"
        climbs={demoBoulder.climbs}
        holds={demoBoulder.holds}
        paths={demoBoulder.paths}
        initialClimbId={climb}
      >
        Procedural demo boulder with {demoBoulder.climbs.length} climbs; pick
        one from the climb list. {HELP}
      </ClimbExplorer>
    );
  }
  return (
    <BoulderViewer src={src} label="3D scan preview" className="h-dvh w-full">
      Development preview of a boulder scan loaded from {src}. {HELP}
    </BoulderViewer>
  );
}
