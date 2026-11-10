import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { Skeleton } from "./skeleton";

// Skeletons mirror the final layout so content lands without a jump. They
// compose the Skeleton primitive and stay still under reduced motion.

const bone = "motion-reduce:animate-none";

type SkeletonPatternProps = {
  className?: string;
};

/** Announces the region once; the bones are empty boxes with nothing to read. */
function LoadingRegion({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      aria-busy="true"
      className={className}
      data-slot="loading-skeleton"
      role="status"
    >
      <span className="sr-only">{t("common:empty.loading")}</span>
      {children}
    </div>
  );
}

const ROW_TITLE_WIDTHS = [
  "w-3/5",
  "w-2/5",
  "w-1/2",
  "w-2/3",
  "w-1/3",
  "w-[45%]",
];

/** Compact list rows: status glyph, key, title, chips and an avatar. */
export function ListRowsSkeleton({
  rows = 8,
  className,
}: SkeletonPatternProps & { rows?: number }) {
  return (
    <LoadingRegion className={cn("flex w-full flex-col", className)}>
      <div className="flex h-8 items-center gap-2 border-b bg-muted/40 px-4">
        <Skeleton className={cn("h-2.5 w-20", bone)} />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
          key={index}
          className="flex h-9 items-center gap-3 border-b border-border/60 px-4 last:border-b-0"
        >
          <Skeleton className={cn("size-3.5 rounded-full", bone)} />
          <Skeleton className={cn("h-3 w-12", bone)} />
          <Skeleton
            className={cn(
              "h-3",
              ROW_TITLE_WIDTHS[index % ROW_TITLE_WIDTHS.length],
              bone,
            )}
          />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton
              className={cn("hidden h-4 w-14 rounded-full sm:block", bone)}
            />
            <Skeleton className={cn("size-5 rounded-full", bone)} />
          </div>
        </div>
      ))}
    </LoadingRegion>
  );
}

function TaskCardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2">
        <Skeleton className={cn("size-3 rounded-full", bone)} />
        <Skeleton className={cn("h-2.5 w-12", bone)} />
      </div>
      <Skeleton className={cn("h-3 w-11/12", bone)} />
      {lines > 1 && <Skeleton className={cn("h-3 w-3/5", bone)} />}
      <div className="flex items-center gap-2 pt-1">
        <Skeleton className={cn("h-4 w-10 rounded-full", bone)} />
        <Skeleton className={cn("h-4 w-8 rounded-full", bone)} />
        <Skeleton className={cn("ml-auto size-5 rounded-full", bone)} />
      </div>
    </div>
  );
}

type BoardColumnsProps = { columns?: number; cards?: number };

function BoardColumns({ columns = 4, cards = 3 }: BoardColumnsProps) {
  return (
    <>
      {Array.from({ length: columns }, (_, column) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder columns
          key={column}
          className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/60 p-2"
        >
          <div className="flex h-7 items-center gap-2 px-1">
            <Skeleton className={cn("size-3.5 rounded-full", bone)} />
            <Skeleton className={cn("h-3 w-20", bone)} />
            <Skeleton className={cn("h-3 w-4", bone)} />
          </div>
          {Array.from(
            { length: Math.max(1, cards - (column % 2)) },
            (_, card) => (
              <TaskCardSkeleton
                // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder cards
                key={card}
                lines={(column + card) % 2 === 0 ? 2 : 1}
              />
            ),
          )}
        </div>
      ))}
    </>
  );
}

/** Board columns: a muted well per column with a header and a few cards. */
export function BoardColumnsSkeleton({
  columns,
  cards,
  className,
}: SkeletonPatternProps & BoardColumnsProps) {
  return (
    <LoadingRegion
      className={cn("flex w-full gap-3 overflow-hidden p-4", className)}
    >
      <BoardColumns cards={cards} columns={columns} />
    </LoadingRegion>
  );
}

/** A responsive grid of cards, as on project, view and cycle overviews. */
export function CardGridSkeleton({
  cards = 6,
  className,
}: SkeletonPatternProps & { cards?: number }) {
  return (
    <LoadingRegion
      className={cn(
        "grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3",
        className,
      )}
    >
      {Array.from({ length: cards }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder cards
          key={index}
          className="flex flex-col gap-3 rounded-xl border bg-card p-4"
        >
          <div className="flex items-center gap-2.5">
            <Skeleton className={cn("size-8 rounded-lg", bone)} />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className={cn("h-3 w-1/2", bone)} />
              <Skeleton className={cn("h-2.5 w-1/4", bone)} />
            </div>
          </div>
          <Skeleton className={cn("h-2.5 w-full", bone)} />
          <Skeleton className={cn("h-2.5 w-4/5", bone)} />
          <div className="flex items-center gap-2 pt-1">
            <Skeleton className={cn("h-1.5 flex-1 rounded-full", bone)} />
            <Skeleton className={cn("h-2.5 w-8", bone)} />
          </div>
        </div>
      ))}
    </LoadingRegion>
  );
}

/** A page: header with title, sentence and action, then a body block. */
export function PageSkeleton({
  className,
  children,
}: SkeletonPatternProps & { children?: React.ReactNode }) {
  return (
    <LoadingRegion
      className={cn("flex w-full flex-col gap-6 p-4 md:p-6", className)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className={cn("h-6 w-48", bone)} />
          <Skeleton className={cn("h-3 w-72 max-w-full", bone)} />
        </div>
        <Skeleton className={cn("h-8 w-24 rounded-lg", bone)} />
      </div>
      <div className="flex gap-4 border-b pb-2">
        <Skeleton className={cn("h-3 w-12", bone)} />
        <Skeleton className={cn("h-3 w-16", bone)} />
        <Skeleton className={cn("h-3 w-10", bone)} />
      </div>
      {children ?? (
        <div className="flex flex-col gap-3">
          <Skeleton className={cn("h-3 w-full", bone)} />
          <Skeleton className={cn("h-3 w-11/12", bone)} />
          <Skeleton className={cn("h-3 w-4/5", bone)} />
          <Skeleton className={cn("h-3 w-2/3", bone)} />
        </div>
      )}
    </LoadingRegion>
  );
}

type LoadingSkeletonProps = {
  className?: string;
};

/**
 * The whole app while the session loads: icon rail, context panel, top bar
 * with the command field, then a board. Phones get the bottom tab bar.
 */
export function LoadingSkeleton({ className }: LoadingSkeletonProps) {
  return (
    <LoadingRegion className={cn("flex h-svh w-full bg-background", className)}>
      <div className="hidden w-16 shrink-0 flex-col items-center gap-3 border-r bg-sidebar py-3 min-[520px]:flex">
        <Skeleton className={cn("size-9 rounded-xl", bone)} />
        <div className="mt-2 flex flex-col items-center gap-3">
          {["home", "inbox", "work", "projects", "pages", "analytics"].map(
            (item) => (
              <div key={item} className="flex flex-col items-center gap-1">
                <Skeleton className={cn("size-8 rounded-lg", bone)} />
                <Skeleton className={cn("h-1.5 w-8", bone)} />
              </div>
            ),
          )}
        </div>
        <Skeleton className={cn("mt-auto size-8 rounded-full", bone)} />
      </div>

      <div className="hidden w-62 shrink-0 flex-col gap-2 border-r bg-card p-3 lg:flex">
        <div className="flex h-8 items-center gap-2">
          <Skeleton className={cn("size-6 rounded-lg", bone)} />
          <Skeleton className={cn("h-3 w-28", bone)} />
        </div>
        <Skeleton className={cn("mt-3 h-2 w-16", bone)} />
        {["a", "b", "c", "d", "e"].map((item, index) => (
          <div key={item} className="flex h-7 items-center gap-2 px-1">
            <Skeleton className={cn("size-4 rounded-md", bone)} />
            <Skeleton
              className={cn("h-2.5", index % 2 ? "w-24" : "w-32", bone)}
            />
          </div>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-13 shrink-0 items-center gap-3 px-4">
          <Skeleton className={cn("size-7 rounded-lg", bone)} />
          <Skeleton className={cn("h-3.5 w-32", bone)} />
          <Skeleton
            className={cn("mx-auto hidden h-8 w-80 rounded-lg md:block", bone)}
          />
          <Skeleton
            className={cn("ml-auto h-8 w-24 rounded-lg md:ml-0", bone)}
          />
        </div>
        <div className="flex h-10 shrink-0 items-center gap-5 border-b px-4">
          <Skeleton className={cn("h-2.5 w-12", bone)} />
          <Skeleton className={cn("h-2.5 w-10", bone)} />
          <Skeleton className={cn("h-2.5 w-14", bone)} />
        </div>
        <div className="flex flex-1 gap-3 overflow-hidden p-4">
          <BoardColumns />
        </div>
        <div className="flex h-14 shrink-0 items-center justify-around border-t bg-sidebar min-[520px]:hidden">
          {["home", "work", "create", "inbox", "menu"].map((item) => (
            <Skeleton
              key={item}
              className={cn(
                item === "create" ? "size-9 rounded-xl" : "size-6 rounded-lg",
                bone,
              )}
            />
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}
