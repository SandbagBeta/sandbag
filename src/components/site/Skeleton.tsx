/** Shimmering placeholder block. Decorative; wrappers carry the busy status. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`skeleton rounded-md ${className}`} />
  );
}

/** Placeholder matching a BoulderCards grid cell. */
export function CardSkeleton() {
  return (
    <div className="border-line bg-surface overflow-hidden rounded-xl border">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="space-y-2 p-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Wraps a loading.tsx page: one polite status for assistive tech. */
export function LoadingShell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <main className="page" aria-busy="true">
      <p role="status" className="sr-only">
        {label}
      </p>
      {children}
    </main>
  );
}
