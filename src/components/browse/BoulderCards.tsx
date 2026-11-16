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
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
      {boulders.map((b) => (
        <li key={b.id} className="min-w-0">
          <Link
            href={`/boulder/${b.id}`}
            className="group border-line bg-surface hover:border-moss block overflow-hidden rounded-xl border transition-[border-color,box-shadow] duration-150 hover:shadow-md focus-visible:outline-offset-2"
          >
            <BoulderThumb src={b.thumbPath ? publicUrl(b.thumbPath) : null} />
            <div className="min-h-11 space-y-0.5 p-3">
              <p className="font-display group-hover:text-moss truncate text-base font-semibold">
                {b.climbNames.length ? b.climbNames.join(", ") : "Boulder scan"}
              </p>
              <p className="text-muted truncate text-xs tabular-nums">
                {climbSummary(b)}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
