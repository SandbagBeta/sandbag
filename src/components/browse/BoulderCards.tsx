import Link from "next/link";
import { publishedGlbUrl as publishedUrl } from "@/lib/boulder/load";
import type { BoulderCard } from "@/lib/browse/load";
import { BoulderThumb } from "./BoulderThumb";

export interface BoulderCardsProps {
  boulders: BoulderCard[];
  /** Supabase project URL; thumbnails live in the public `published` bucket. */
  supabaseUrl: string;
}

export function climbSummary(b: Pick<BoulderCard, "climbNames" | "grades">) {
  const n = b.climbNames.length;
  if (n === 0) return "No climbs yet";
  const range =
    b.grades.length > 1
      ? `${b.grades[0]}–${b.grades[b.grades.length - 1]}`
      : b.grades[0];
  return `${n} climb${n === 1 ? "" : "s"} · ${range}`;
}

export function BoulderCards({ boulders, supabaseUrl }: BoulderCardsProps) {
  const publicUrl = (key: string) => publishedUrl(supabaseUrl, key);
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {boulders.map((b) => (
        <li key={b.id}>
          <Link
            href={`/boulder/${b.id}`}
            className="block rounded-lg border border-stone-200 p-2 hover:border-stone-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:border-stone-800 dark:hover:border-stone-600"
          >
            <BoulderThumb src={b.thumbPath ? publicUrl(b.thumbPath) : null} />
            <p className="mt-2 truncate text-sm font-medium">
              {b.climbNames.length ? b.climbNames.join(", ") : "Boulder scan"}
            </p>
            <p className="text-xs text-stone-600 tabular-nums dark:text-stone-400">
              {climbSummary(b)}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
