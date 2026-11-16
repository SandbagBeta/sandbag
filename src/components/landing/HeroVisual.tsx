"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { HeroClimb } from "@/components/viewer/hero/HeroViewer";
import { useHeroMode } from "./heroMode";

// Own chunk: three.js never ships with the landing page's initial JS.
const HeroViewer = dynamic(
  () => import("@/components/viewer/hero/HeroViewer"),
  { ssr: false },
);

const LABEL =
  "3D scan of the demo boulder swinging side to side, lighting up the line of each climb as it comes to face you";

/**
 * Reserved-size hero box: a static poster paints first (it is the LCP image
 * and the permanent fallback for no WebGL / reduced motion). Once the live
 * canvas has loaded, the poster fades out: the canvas is transparent, so a
 * poster left underneath shows through as a second, offset rock.
 */
export function HeroVisual() {
  const boxRef = useRef<HTMLDivElement>(null);
  const { live, paused } = useHeroMode(boxRef);
  const [ready, setReady] = useState(false);
  const [caption, setCaption] = useState<HeroClimb | null>(null);
  return (
    <div
      ref={boxRef}
      data-slot="hero-visual"
      data-hero-state={live ? (ready ? "live" : "loading") : "poster"}
      role="img"
      aria-label={LABEL}
      className="relative mx-auto aspect-[4/3] w-full max-w-xl lg:max-w-none"
    >
      {/* Plain img: a 47 KB pre-optimized PNG, and next/image would add its
          client runtime to the landing page's first-load JS. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/hero-boulder.png"
        alt=""
        width={720}
        height={540}
        fetchPriority="high"
        decoding="async"
        className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-700 ${live && ready ? "opacity-0" : "opacity-100"}`}
      />
      {live && (
        <div
          className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}
        >
          <HeroViewer
            label={LABEL}
            className="h-full w-full"
            paused={paused}
            onReady={() => setReady(true)}
            onActiveClimb={setCaption}
          />
        </div>
      )}
      {live && ready && caption && (
        <p
          aria-hidden="true"
          data-testid="hero-caption"
          className="bg-surface/90 border-line text-ink absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap shadow-sm backdrop-blur-sm"
        >
          {caption.name}
          {caption.grade ? ` · ${caption.grade}` : ""}
        </p>
      )}
    </div>
  );
}
