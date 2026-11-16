import { Skeleton } from "@/components/site/Skeleton";

/** Mirrors ClimbExplorer's layout (viewer slot + side panel) to avoid a jump. */
export default function Loading() {
  return (
    <main
      aria-busy="true"
      className="h-view bg-paper flex flex-col md:flex-row"
    >
      <p role="status" className="sr-only">
        Loading boulder
      </p>
      <Skeleton className="h-[60dvh] w-full shrink-0 rounded-none md:h-full md:flex-1" />
      <div className="border-line min-w-0 flex-1 space-y-4 p-4 md:w-80 md:flex-none md:border-l">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </main>
  );
}
