import { Skeleton } from "@/components/ui/skeleton";

const ROWS = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** Eight placeholder rows while the first page loads. */
export default function InboxSkeleton() {
  return (
    <div aria-hidden="true">
      {ROWS.map((row) => (
        <div
          key={row}
          className="flex gap-3 border-border/60 border-b px-3 py-2.5"
        >
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 py-0.5">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
