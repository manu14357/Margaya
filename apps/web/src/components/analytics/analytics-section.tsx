import { ChartColumn, Info, Table2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { HttpError } from "@/lib/http-error";

export type SectionView = "chart" | "table";

/** A 503 is the API's statement timeout: the filters are too broad. */
export function isAnalyticsTimeout(error: unknown): boolean {
  return error instanceof HttpError && error.status === 503;
}

export function SectionError({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-2 py-8 text-center",
        className,
      )}
    >
      <p className="text-muted-foreground text-sm">
        {isAnalyticsTimeout(error)
          ? t("analytics:states.timeout")
          : t("analytics:states.loadError")}
      </p>
      {onRetry && (
        <Button variant="outline" size="xs" onClick={onRetry}>
          {t("analytics:states.retry")}
        </Button>
      )}
    </div>
  );
}

export function SectionEmpty({ title }: { title: string }) {
  return (
    <p className="py-10 text-center text-muted-foreground text-sm">{title}</p>
  );
}

export function ViewToggle({
  value,
  onChange,
}: {
  value: SectionView;
  onChange: (view: SectionView) => void;
}) {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      size="sm"
      variant="outline"
      aria-label={t("analytics:view.label")}
      value={[value]}
      onValueChange={(values) => {
        const next = values[0];
        if (next === "chart" || next === "table") onChange(next);
      }}
    >
      <Toggle
        value="chart"
        aria-label={t("analytics:view.chart")}
        title={t("analytics:view.chart")}
        className="px-1.5"
      >
        <ChartColumn className="size-3.5" />
      </Toggle>
      <Toggle
        value="table"
        aria-label={t("analytics:view.table")}
        title={t("analytics:view.table")}
        className="px-1.5"
      >
        <Table2 className="size-3.5" />
      </Toggle>
    </ToggleGroup>
  );
}

type AnalyticsSectionProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** A longer explanation behind an info icon beside the title. */
  help?: string;
  actions?: ReactNode;
  /** Controls under the title (period, metric, builder selects). */
  controls?: ReactNode;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyTitle?: string;
  /** Replaces the default skeleton block while loading. */
  skeleton?: ReactNode;
  /** A newer result is loading: the current one stays, dimmed. */
  isRefreshing?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
};

/**
 * The frame of every analytics section: a card with a title row and its
 * own loading, empty and error states, so one failing section never blanks
 * the page.
 */
export default function AnalyticsSection({
  title,
  subtitle,
  help,
  actions,
  controls,
  isLoading = false,
  error,
  onRetry,
  isEmpty = false,
  emptyTitle,
  skeleton,
  isRefreshing = false,
  className,
  bodyClassName,
  children,
}: AnalyticsSectionProps) {
  const body = (() => {
    if (isLoading) {
      return skeleton ?? <Skeleton className="h-48 w-full rounded-lg" />;
    }
    if (error) return <SectionError error={error} onRetry={onRetry} />;
    if (isEmpty && emptyTitle) return <SectionEmpty title={emptyTitle} />;
    return (
      <div
        aria-busy={isRefreshing || undefined}
        className={cn(
          "transition-opacity duration-150 motion-reduce:transition-none",
          isRefreshing && "opacity-60",
        )}
      >
        {children}
      </div>
    );
  })();

  return (
    <Card className={cn("min-w-0 gap-3 p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="font-medium text-sm">{title}</h2>
            {help && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={help}
                      className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                    />
                  }
                >
                  <Info className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent className="max-w-72">{help}</TooltipContent>
              </Tooltip>
            )}
          </div>
          {subtitle && (
            <div className="mt-0.5 text-muted-foreground text-xs">
              {subtitle}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
        )}
      </div>
      {controls && (
        <div className="flex flex-wrap items-center gap-2">{controls}</div>
      )}
      <div className={cn("min-w-0", bodyClassName)}>{body}</div>
    </Card>
  );
}
