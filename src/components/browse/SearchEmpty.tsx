import Link from "next/link";
import { EmptyState } from "@/components/site/EmptyState";

const link =
  "text-moss font-semibold underline underline-offset-4 hover:no-underline";

/** `idle`: nothing searched yet. `none`: a search that matched nothing. */
export function SearchEmpty({ kind }: { kind: "idle" | "none" }) {
  if (kind === "idle") {
    return (
      <EmptyState title="Find a boulder">
        Search by climb or area name, or pick a grade range. Not sure where to
        start?{" "}
        <Link href="/areas" className={link}>
          Browse by area
        </Link>
        .
      </EmptyState>
    );
  }
  return (
    <EmptyState title="Nothing published matches">
      <p>Try one of these:</p>
      <ul className="mt-2 space-y-1 text-left">
        <li>Use fewer or shorter words, or check the spelling.</li>
        <li>Widen the grade range, or set it to Any.</li>
        <li>
          Or{" "}
          <Link href="/areas" className={link}>
            browse by area
          </Link>
          .
        </li>
      </ul>
    </EmptyState>
  );
}
