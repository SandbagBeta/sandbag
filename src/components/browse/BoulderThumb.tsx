"use client";

import { useState } from "react";

/**
 * Fixed-size thumbnail (no layout shift) that falls back to a plain tile when
 * the scan has no thumbnail or it fails to load. Decorative: the card text
 * names the boulder.
 */
export function BoulderThumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  const show = src && !failed;
  return (
    <div className="aspect-square w-full overflow-hidden rounded-md bg-stone-200 dark:bg-stone-800">
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element -- immutable public object; next/image would need remotePatterns per storage host.
        <img
          src={src}
          alt=""
          width={512}
          height={512}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="flex h-full w-full items-center justify-center text-3xl text-stone-400"
        >
          ⛰
        </div>
      )}
    </div>
  );
}
