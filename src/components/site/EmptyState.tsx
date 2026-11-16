import type { ReactNode } from "react";

/** Friendly empty/error panel: a heading, a line of help, and next steps. */
export function EmptyState({
  title,
  children,
  actions,
  headingLevel: H = "h2",
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  headingLevel?: "h1" | "h2";
}) {
  return (
    <div className="border-line bg-surface relative overflow-hidden rounded-xl border px-5 py-10 text-center sm:px-10">
      <div aria-hidden="true" className="topo absolute inset-0 opacity-30" />
      <div className="relative mx-auto flex max-w-md flex-col items-center gap-3">
        <svg
          viewBox="0 0 24 24"
          width="40"
          height="40"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          aria-hidden="true"
          className="text-moss"
        >
          <path d="M2.5 19.5 9 7l4 7 2.5-4 6 9.5z" />
        </svg>
        <H className="font-display text-2xl font-semibold tracking-tight">
          {title}
        </H>
        {children && <div className="text-muted text-sm">{children}</div>}
        {actions && (
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
