"use client";

import { useState } from "react";

/**
 * Fixed-ratio thumbnail (no layout shift) that falls back to a topographic
 * placeholder when the scan has no thumbnail or it fails to load. Decorative:
 * the card text names the boulder.
 */
export function BoulderThumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  const show = src && !failed;
  return (
    <div
      data-thumb={show ? "image" : "placeholder"}
      className="bg-line relative aspect-[4/3] w-full overflow-hidden"
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element -- immutable public object; next/image would need remotePatterns per storage host.
        <img
          src={src}
          alt=""
          width={512}
          height={384}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div aria-hidden className="bg-surface absolute inset-0">
          <div className="topo absolute inset-0 opacity-70" />
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            className="text-moss absolute inset-0 m-auto h-1/3 w-1/3 opacity-80"
          >
            <path d="M2.5 19.5 9 7l4 7 2.5-4 6 9.5z" />
          </svg>
        </div>
      )}
    </div>
  );
}
