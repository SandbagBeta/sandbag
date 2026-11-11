import Link from "next/link";
import type { AreaNode } from "@/lib/browse/tree";

const scans = (n: number) => `${n} scan${n === 1 ? "" : "s"}`;

/** Nested list of areas with published-scan counts. Plain links, no JS. */
export function AreaTree({ nodes }: { nodes: AreaNode[] }) {
  return (
    <ul className="space-y-1">
      {nodes.map((n) => (
        <li key={n.id}>
          <Link
            href={`/area/${n.id}`}
            className="inline-flex gap-2 rounded px-1 hover:underline focus-visible:outline-2 focus-visible:outline-sky-600"
          >
            <span className="font-medium">{n.name}</span>{" "}
            <span className="text-stone-600 tabular-nums dark:text-stone-400">
              {scans(n.scanCount)}
            </span>
          </Link>
          {n.children.length > 0 && (
            <div className="mt-1 ml-4 border-l border-stone-200 pl-3 dark:border-stone-800">
              <AreaTree nodes={n.children} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
