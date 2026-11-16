import {
  CardGridSkeleton,
  LoadingShell,
  Skeleton,
} from "@/components/site/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Loading area">
      <div className="space-y-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-10 w-2/3" />
      </div>
      <CardGridSkeleton />
    </LoadingShell>
  );
}
