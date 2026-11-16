import Link from "next/link";
import { EmptyState } from "@/components/site/EmptyState";

export default function NotFound() {
  return (
    <main className="page">
      <EmptyState
        headingLevel="h1"
        title="We could not find that page"
        actions={
          <>
            <Link href="/areas" className="btn btn-primary">
              Browse areas
            </Link>
            <Link href="/search" className="btn btn-ghost">
              Search
            </Link>
            <Link href="/" className="btn btn-ghost">
              Home
            </Link>
          </>
        }
      >
        The page may have moved, or the boulder is not published yet.
      </EmptyState>
    </main>
  );
}
