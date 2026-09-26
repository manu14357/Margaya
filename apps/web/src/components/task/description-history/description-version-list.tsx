import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { DescriptionVersion } from "@/fetchers/task-description-version/list-description-versions";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";

type DescriptionVersionListProps = {
  versions: readonly DescriptionVersion[];
  isLoading: boolean;
  selectedId: string | undefined;
  onSelect: (versionId: string) => void;
};

/** Saved versions, newest first: when, who and how it starts. */
export default function DescriptionVersionList({
  versions,
  isLoading,
  selectedId,
  onSelect,
}: DescriptionVersionListProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="space-y-1">
        {["a", "b", "c", "d"].map((key) => (
          <Skeleton key={key} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <p className="px-2.5 py-3 text-muted-foreground text-sm">
        {t("tasks:descriptionHistory.empty")}
      </p>
    );
  }

  return (
    <ol className="space-y-0.5" aria-label={t("tasks:descriptionHistory.list")}>
      {versions.map((version, index) => {
        const selected = version.id === selectedId;
        const authorName =
          version.author?.name ?? t("tasks:descriptionHistory.earlierVersion");
        return (
          <li key={version.id}>
            <button
              type="button"
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(version.id)}
              className={cn(
                "relative flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left hover:bg-accent",
                selected &&
                  "bg-secondary before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:rounded-full before:bg-primary",
              )}
            >
              <span className="flex items-center gap-2 font-medium text-sm">
                <span className="truncate">
                  {formatDateTime(version.savedAt)}
                </span>
                {index === 0 && (
                  <Badge variant="outline" className="shrink-0">
                    {t("tasks:descriptionHistory.latest")}
                  </Badge>
                )}
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                <Avatar className="size-4">
                  <AvatarImage src={version.author?.image ?? ""} alt="" />
                  <AvatarFallback className="text-[8px]">
                    {getInitials(version.author?.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{authorName}</span>
                <span className="shrink-0">
                  {t("tasks:descriptionHistory.size", { count: version.size })}
                </span>
              </span>
              {version.preview && (
                <span className="line-clamp-2 text-muted-foreground text-xs">
                  {version.preview}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
