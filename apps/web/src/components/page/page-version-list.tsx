import { History } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetPageVersions } from "@/hooks/queries/page/use-get-page-versions";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import MemberAvatar from "./member-avatar";
import type { PageMember } from "./use-page-members";

type PageVersionListProps = {
  pageId: string;
  selectedVersionId?: string;
  onSelect: (versionId: string | undefined) => void;
  getMember: (userId: string | null | undefined) => PageMember | null;
};

/** "Current version", then saved versions, newest first (§1.11). */
export default function PageVersionList({
  pageId,
  selectedVersionId,
  onSelect,
  getMember,
}: PageVersionListProps) {
  const { t } = useTranslation();
  const versions = useGetPageVersions(pageId, true);

  const rowClass = (selected: boolean) =>
    cn(
      "relative flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left hover:bg-accent",
      selected &&
        "bg-secondary before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:rounded-full before:bg-primary",
    );

  return (
    <ol className="space-y-0.5" aria-label={t("pages:history.title")}>
      <li>
        <button
          type="button"
          className={rowClass(!selectedVersionId)}
          aria-current={!selectedVersionId ? "true" : undefined}
          onClick={() => onSelect(undefined)}
        >
          <span className="flex items-center gap-2 font-medium text-sm">
            <History className="size-3.5 text-muted-foreground" />
            {t("pages:history.current")}
          </span>
        </button>
      </li>
      {versions.isLoading &&
        Array.from({ length: 5 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
          <li key={index}>
            <Skeleton className="h-10 w-full" />
          </li>
        ))}
      {!versions.isLoading && (versions.data ?? []).length === 0 && (
        <li className="px-2.5 py-3 text-muted-foreground text-xs">
          {t("pages:history.empty")}
        </li>
      )}
      {(versions.data ?? []).map((version) => {
        const owner = getMember(version.ownerId);
        const ownerName = owner?.name ?? t("pages:history.unknownUser");
        const others = version.contributorIds.filter(
          (id) => id !== version.ownerId,
        ).length;
        const selected = version.id === selectedVersionId;
        return (
          <li key={version.id}>
            <button
              type="button"
              className={rowClass(selected)}
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(version.id)}
            >
              <span className="font-medium text-sm">
                {formatDateTime(version.lastSavedAt)}
              </span>
              <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                <MemberAvatar
                  name={ownerName}
                  image={owner?.image}
                  className="size-4"
                />
                <span className="truncate">{ownerName}</span>
                {others > 0 && (
                  <span className="shrink-0">
                    {t("pages:history.others", { count: others })}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
