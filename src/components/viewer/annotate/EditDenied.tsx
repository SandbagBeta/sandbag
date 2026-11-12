import Link from "next/link";
import type { FailureHelp } from "@/lib/annotations/failureHelp";

/** Why you can't edit this climb: what happened, what to do, next steps. */
export function EditDenied({
  help,
  boulderHref,
}: {
  help: FailureHelp;
  boulderHref: string;
}) {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">
        You can&apos;t edit this climb
      </h1>
      <p role="alert">{help.whatHappened}</p>
      <p className="text-sm opacity-80">Step: {help.stageLabel}</p>
      {help.whatYouCanDo.length > 0 && (
        <section aria-label="What you can do">
          <h2 className="font-semibold">What you can do</h2>
          <ul className="list-disc pl-5">
            {help.whatYouCanDo.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}
      {help.nextSteps.length > 0 && (
        <section aria-label="Next steps">
          <h2 className="font-semibold">Next steps</h2>
          <ul className="list-disc pl-5">
            {help.nextSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex gap-4 text-sm">
        <Link href={boulderHref} className="underline">
          Back to the boulder
        </Link>
        <Link href="/account" className="underline">
          Your account
        </Link>
      </div>
    </main>
  );
}
