import Link from "next/link";
import { BoulderThumb } from "@/components/browse/BoulderThumb";
import { sandbagLabel } from "@/lib/grades/consensus";
import { EmptyState } from "@/components/site/EmptyState";
import type { MyClimb, MyVote, UploadItem } from "@/lib/profile/dashboard";
import { STATUS_HELP, STATUS_LABEL } from "@/lib/scan-report/format";
import { StepTracker } from "./StepTracker";

const day = (iso: string) => iso.slice(0, 10);

const linkCls =
  "text-moss inline-flex min-h-11 items-center font-semibold underline underline-offset-4 hover:no-underline";

export function UploadsSection({
  uploads,
  thumbs,
}: {
  uploads: UploadItem[];
  thumbs: Record<string, string | null>;
}) {
  return (
    <section aria-labelledby="uploads-heading" className="space-y-3">
      <h2 id="uploads-heading" className="font-display text-xl font-semibold">
        Your uploads
      </h2>
      {uploads.length === 0 ? (
        <EmptyState
          title="No uploads yet"
          actions={
            <Link href="/upload" className="btn btn-primary">
              Upload a scan
            </Link>
          }
        >
          Scans you upload show up here, with where each one is in the checks.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {uploads.map((u) => (
            <li
              key={u.id}
              className="border-line bg-surface flex gap-3 rounded-xl border p-3"
            >
              <div className="w-24 shrink-0 self-start overflow-hidden rounded-md sm:w-36">
                <BoulderThumb src={thumbs[u.id] ?? null} />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="font-semibold">
                  {STATUS_LABEL[u.status]}{" "}
                  <time
                    dateTime={u.createdAt}
                    className="text-muted text-xs font-normal"
                  >
                    {day(u.createdAt)}
                  </time>
                </p>
                <StepTracker steps={u.steps} />
                <p className="text-muted text-sm">{STATUS_HELP[u.status]}</p>
                {u.reason && (
                  <p className="text-sm whitespace-pre-wrap">
                    <strong>Reason:</strong> {u.reason}
                  </p>
                )}
                <Link href={`/upload/scans/${u.id}`} className={linkCls}>
                  Details
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const CLIMB_STATUS: Record<string, string> = {
  pending_review: "Waiting for review",
  published: "Published",
  rejected: "Rejected",
};

export function ClimbsSection({ climbs }: { climbs: MyClimb[] }) {
  return (
    <section aria-labelledby="climbs-heading" className="space-y-3">
      <h2 id="climbs-heading" className="font-display text-xl font-semibold">
        Your climbs
      </h2>
      {climbs.length === 0 ? (
        <EmptyState title="No climbs yet">
          Open a published boulder and trace a line to add your first climb.
        </EmptyState>
      ) : (
        <ul className="divide-line border-line bg-surface divide-y rounded-xl border">
          {climbs.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-x-4 px-3"
            >
              <span className="min-h-11 py-2">
                <span className="font-semibold">{c.name}</span>{" "}
                <span className="text-muted tabular-nums">{c.grade}</span>
                <span className="text-muted block text-xs">
                  {CLIMB_STATUS[c.status] ?? c.status}
                </span>
              </span>
              <span className="flex gap-4">
                {c.climbHref && (
                  <Link href={c.climbHref} className={linkCls}>
                    Climb
                  </Link>
                )}
                <Link href={c.boulderHref} className={linkCls}>
                  Boulder
                </Link>
                {c.editHref && (
                  <Link href={c.editHref} className={linkCls}>
                    Edit
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function compare(v: MyVote): string {
  if (!v.consensus) return "Not enough votes for a community grade yet";
  const where =
    v.offset === 0
      ? "you agree"
      : v.offset === null
        ? ""
        : `you voted ${Math.abs(v.offset)} ${Math.abs(v.offset) === 1 ? "grade" : "grades"} ${v.offset > 0 ? "harder" : "easier"}`;
  return `Community ${v.consensus} (${v.votes} votes)${where ? `, ${where}` : ""}`;
}

export function VotesSection({ votes }: { votes: MyVote[] }) {
  return (
    <section aria-labelledby="votes-heading" className="space-y-3">
      <h2 id="votes-heading" className="font-display text-xl font-semibold">
        Your grade votes
      </h2>
      {votes.length === 0 ? (
        <EmptyState title="No grade votes yet">
          Vote on a climb&apos;s grade and see how you compare with everyone
          else here.
        </EmptyState>
      ) : (
        <ul className="divide-line border-line bg-surface divide-y rounded-xl border">
          {votes.map((v) => (
            <li key={v.climbId} className="px-3">
              <Link
                href={`/climb/${v.climbId}`}
                className="flex min-h-11 flex-col justify-center py-2"
              >
                <span className="font-semibold underline-offset-4 hover:underline">
                  {v.name}{" "}
                  <span className="text-muted tabular-nums">
                    your vote {v.myGrade}
                  </span>
                </span>
                <span className="text-muted text-xs">
                  {compare(v)}
                  {sandbagLabel(v.sandbagged) &&
                    ` · ${sandbagLabel(v.sandbagged)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
