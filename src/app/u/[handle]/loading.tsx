import {
  CardGridSkeleton,
  LoadingShell,
  Skeleton,
} from "@/components/site/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Loading profile">
      <Skeleton className="h-10 w-48" />
      <CardGridSkeleton count={3} />
    </LoadingShell>
  );
}
