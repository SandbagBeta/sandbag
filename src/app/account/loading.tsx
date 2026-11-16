import { LoadingShell, Skeleton } from "@/components/site/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Loading your account">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-11 w-full" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-28 w-full" />
      ))}
    </LoadingShell>
  );
}
