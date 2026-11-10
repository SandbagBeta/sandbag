import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  DEFAULT_VIEWER_SRC,
  parseViewerSrc,
} from "@/components/viewer/srcParam";
import { isDevHarnessEnabled } from "../devHarness";
import { ViewerClient } from "./ViewerClient";

export const metadata: Metadata = {
  title: "Viewer dev page — SandBag",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Dev harness: /dev/viewer?src=<glb-url>. Defaults to the #8 demo fixture. */
export default async function ViewerDevPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Dev-only harness: 404 on Vercel production and self-hosted builds,
  // available in dev and on Vercel preview deployments (phone testing).
  if (!isDevHarnessEnabled()) notFound();
  const { src } = await searchParams;
  const parsed = parseViewerSrc(Array.isArray(src) ? src[0] : src);
  return (
    <main className="relative h-dvh w-full">
      {src !== undefined && parsed === null && (
        <p
          role="alert"
          className="absolute top-2 left-2 z-10 rounded bg-red-100 px-3 py-1 text-sm text-red-900 dark:bg-red-950 dark:text-red-200"
        >
          Ignored invalid <code>?src</code>; showing the demo fixture.
        </p>
      )}
      <ViewerClient src={parsed ?? DEFAULT_VIEWER_SRC} />
    </main>
  );
}
