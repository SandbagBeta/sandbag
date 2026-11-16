import {
  CardGridSkeleton,
  LoadingShell,
  Skeleton,
} from "@/components/site/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Loading areas">
      <Skeleton className="h-10 w-40" />
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <CardGridSkeleton count={3} />
    </LoadingShell>
  );
}
