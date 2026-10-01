import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** The board-and-sidebar skeleton while a cycle or module page loads. */
export function PlanningPageSkeleton() {
  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        {["a", "b", "c"].map((column) => (
          <div key={column} className="flex w-72 shrink-0 flex-col gap-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
        ))}
      </div>
      <div className="hidden w-80 shrink-0 space-y-4 border-l p-4 lg:block">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    </div>
  );
}

/** A list or page that failed to load: what failed, and a retry. */
export function PlanningLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-muted-foreground text-sm">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("planning:retry")}
      </Button>
    </div>
  );
}
