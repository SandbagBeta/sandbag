import { LoadingShell, Skeleton } from "@/components/site/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Loading search">
      <Skeleton className="h-10 w-40" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="col-span-2 h-11" />
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </LoadingShell>
  );
}
