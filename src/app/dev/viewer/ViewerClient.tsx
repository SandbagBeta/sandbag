"use client";

import dynamic from "next/dynamic";

// The viewer needs WebGL; never render it on the server.
const BoulderViewer = dynamic(
  () =>
    import("@/components/viewer/BoulderViewer").then((m) => m.BoulderViewer),
  { ssr: false },
);

export function ViewerClient({ src }: { src: string }) {
  return (
    <BoulderViewer src={src} label="3D scan preview" className="h-dvh w-full">
      Development preview of a boulder scan loaded from {src}. Use mouse or
      touch to orbit, pan and zoom.
    </BoulderViewer>
  );
}
