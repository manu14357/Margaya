import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

type TaskDetailsSkeletonProps = {
  className?: string;
};

export function TaskDetailsSkeleton({ className }: TaskDetailsSkeletonProps) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-5 pb-16 sm:px-6 xl:pt-8 xl:pb-20",
        className,
      )}
    >
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-10 w-full max-w-[34rem]" />
        <div className="space-y-2.5 pt-1">
          <Skeleton className="h-4 w-full max-w-[42rem]" />
          <Skeleton className="h-4 w-full max-w-[38rem]" />
          <Skeleton className="h-4 w-full max-w-[33rem]" />
          <Skeleton className="h-32 w-full max-w-[44rem] rounded-lg" />
        </div>
      </div>

      <span className="block h-px w-full shrink-0 bg-border" />

      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-20" />

        <div className="rounded-xl border border-border/80 bg-card/70 p-3">
          <Skeleton className="h-16 w-full rounded-lg" />
          <div className="mt-3 flex justify-end">
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
        </div>

        <div className="space-y-3">
          {["row-1", "row-2", "row-3"].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-4 w-full max-w-[28rem]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type TaskPropertiesSidebarSkeletonProps = {
  className?: string;
};

const PROPERTY_ROWS = [
  "status",
  "priority",
  "assignees",
  "start",
  "due",
  "labels",
  "parent",
];

/** Matches the property grid: an overline with tools, then label/value rows. */
export function TaskPropertiesSidebarSkeleton({
  className,
}: TaskPropertiesSidebarSkeletonProps) {
  return (
    <div className={cn("flex flex-col gap-3 p-3", className)}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-3">
        {PROPERTY_ROWS.map((row) => (
          <div key={row} className="col-span-2 grid grid-cols-subgrid">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
