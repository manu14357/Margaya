import { SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

/** "No tasks match these filters", with a way out (B4 §1.2). */
export function QueryEmpty({
  onClear,
  title,
  description,
}: {
  onClear?: () => void;
  title?: string;
  description?: string;
}) {
  const { t } = useTranslation();
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle>{title ?? t("tasks:queryEmpty.title")}</EmptyTitle>
        <EmptyDescription>
          {description ?? t("tasks:queryEmpty.description")}
        </EmptyDescription>
      </EmptyHeader>
      {onClear && (
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={onClear}>
            {t("tasks:queryEmpty.clear")}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

/** Skeleton rows while a list or spreadsheet loads. */
export function QueryRowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border/50">
      {Array.from({ length: rows }, (_, index) => `row-${index}`).map((key) => (
        <div key={key} className="flex h-9 items-center gap-3 px-4">
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="size-5 rounded-full" />
        </div>
      ))}
    </div>
  );
}
