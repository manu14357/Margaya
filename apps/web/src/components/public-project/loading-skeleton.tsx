import { Skeleton } from "@/components/ui/skeleton";

const COLUMNS = ["column-1", "column-2", "column-3", "column-4"];
const CARDS = ["card-1", "card-2", "card-3"];
const ROWS = ["row-1", "row-2", "row-3", "row-4", "row-5", "row-6"];

/** The canvas while tasks load: column wells, or list rows. */
export function BoardCanvasSkeleton({
  layout = "board",
}: {
  layout?: "board" | "list";
}) {
  if (layout === "list") {
    return (
      <div className="flex-1 space-y-1 p-3 md:p-4" aria-hidden="true">
        <Skeleton className="mb-2 h-6 w-40" />
        {ROWS.map((row) => (
          <Skeleton key={row} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 gap-2 overflow-hidden p-2 md:gap-3 md:p-3">
      {COLUMNS.map((column) => (
        <div
          key={column}
          aria-hidden="true"
          className="flex w-[calc(100vw-(--spacing(4)))] shrink-0 flex-col gap-1.5 rounded-xl bg-muted p-2 md:w-74"
        >
          <Skeleton className="mx-1 my-1.5 h-5 w-28" />
          {CARDS.map((card) => (
            <Skeleton key={`${column}-${card}`} className="h-20 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The whole public board while it loads: top bar, toolbar and canvas. */
export function LoadingSkeleton() {
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <div className="flex min-h-13 shrink-0 items-center gap-3 border-border border-b px-3 md:px-4">
        <Skeleton className="size-8 rounded-[28%]" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mx-auto h-8 w-72 max-md:hidden" />
        <Skeleton className="size-8 rounded-full max-md:ml-auto" />
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-border border-b px-3 md:px-4">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-14" />
        <Skeleton className="ml-auto h-7 w-24" />
      </div>
      <BoardCanvasSkeleton />
    </div>
  );
}
