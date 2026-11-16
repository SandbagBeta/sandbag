"use client";

import Link from "next/link";
import { useEffect } from "react";
import { EmptyState } from "@/components/site/EmptyState";

/** Route-level error boundary. The 3D viewer keeps its own boundary. */
export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="page">
      <EmptyState
        headingLevel="h1"
        title="Something went wrong"
        actions={
          <>
            <button
              type="button"
              onClick={() => retry()}
              className="btn btn-primary"
            >
              Try again
            </button>
            <Link href="/areas" className="btn btn-ghost">
              Browse areas
            </Link>
            <Link href="/" className="btn btn-ghost">
              Home
            </Link>
          </>
        }
      >
        We could not load this page. It is usually temporary, so trying again
        often works.
      </EmptyState>
    </main>
  );
}
