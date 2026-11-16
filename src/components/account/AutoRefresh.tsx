"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the server data every few seconds while something is still being checked. */
export function AutoRefresh({
  active,
  everyMs = 8000,
}: {
  active: boolean;
  everyMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
