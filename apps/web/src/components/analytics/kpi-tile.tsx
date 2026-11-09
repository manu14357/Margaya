import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

type KpiTileProps = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: LucideIcon;
  isLoading?: boolean;
};

/**
 * A headline number. The value stays in text colors; identity never rides
 * on color alone.
 */
export function KpiTile({
  label,
  value,
  detail,
  icon: Icon,
  isLoading = false,
}: KpiTileProps) {
  // Labels and details wrap instead of truncating. The tile spans three rows
  // of KpiRow's grid as a subgrid, so a wrapped label in one tile moves the
  // whole row's numbers down together and they stay aligned.
  return (
    <Card className="row-span-3 grid min-w-0 grid-rows-subgrid content-start gap-1 p-4">
      <div className="flex items-start gap-1.5 text-muted-foreground text-xs">
        {Icon && <Icon aria-hidden className="mt-px size-3.5 shrink-0" />}
        <span className="min-w-0 break-words">{label}</span>
      </div>
      {isLoading ? (
        <Skeleton className="h-7 w-16" />
      ) : (
        <div className="font-semibold text-2xl tabular-nums">{value}</div>
      )}
      {detail && !isLoading && (
        <div className="min-w-0 break-words text-muted-foreground text-xs">
          {detail}
        </div>
      )}
    </Card>
  );
}

/**
 * Tiles two per row on phones, four on tablets, and one row on wide screens.
 * The row's tile count varies with the project features turned on, so wide
 * screens share the width among the tiles present instead of leaving empty
 * columns (and truncated labels) beside them.
 */
export function KpiRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))]",
        className,
      )}
    >
      {children}
    </div>
  );
}
