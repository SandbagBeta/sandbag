import Link from "next/link";
import type { AreaNode } from "@/lib/browse/tree";

const scans = (n: number) => `${n} scan${n === 1 ? "" : "s"}`;

/** Nested list of areas with published-scan counts. Plain links, no JS. */
export function AreaTree({ nodes }: { nodes: AreaNode[] }) {
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.id}>
          <Link
            href={`/area/${n.id}`}
            className="hover:bg-surface hover:text-moss flex min-h-11 items-center justify-between gap-3 rounded-md px-2"
          >
            <span className="font-display font-semibold">{n.name}</span>{" "}
            <span className="text-muted text-sm tabular-nums">
              {scans(n.scanCount)}
            </span>
          </Link>
          {n.children.length > 0 && (
            <div className="border-line mb-1 ml-3 border-l pl-3">
              <AreaTree nodes={n.children} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
