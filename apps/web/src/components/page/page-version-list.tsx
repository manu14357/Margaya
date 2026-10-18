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

const entryClass = (selected: boolean) =>
  cn(
    "flex min-w-0 flex-1 flex-col gap-1 rounded-md px-2 py-1 text-left outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
    selected && "bg-accent hover:bg-accent",
  );

/**
 * The version timeline (§1.11): "Current version", then saved versions,
 * newest first, on a line down the left gutter.
 */
export default function PageVersionList({
  pageId,
  selectedVersionId,
  onSelect,
  getMember,
}: PageVersionListProps) {
  const { t } = useTranslation();
  const versions = useGetPageVersions(pageId, true);

  return (
    <ol className="relative space-y-1" aria-label={t("pages:history.title")}>
      <span
        aria-hidden="true"
        className="absolute start-[11.5px] top-3 bottom-3 w-px bg-border"
      />
      <li className="relative flex items-start gap-4">
        <span aria-hidden="true" className="flex w-6 shrink-0 justify-center">
          <span className="flex size-6 items-center justify-center rounded-full bg-muted">
            <span className="size-2.5 rounded-full bg-foreground/40" />
          </span>
        </span>
        <button
          type="button"
          className={cn(entryClass(!selectedVersionId), "min-h-6 py-1")}
          aria-current={!selectedVersionId ? "true" : undefined}
          onClick={() => onSelect(undefined)}
        >
          <span className="font-medium text-xs">
            {t("pages:history.current")}
          </span>
        </button>
      </li>
      {versions.isLoading &&
        Array.from({ length: 3 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
          <li key={index} className="relative flex gap-4">
            <span className="w-6 shrink-0" />
            <Skeleton className="h-10 flex-1" />
          </li>
        ))}
      {!versions.isLoading && (versions.data ?? []).length === 0 && (
        <li className="relative flex gap-4">
          <span className="w-6 shrink-0" />
          <p className="py-2 text-muted-foreground text-xs">
            {t("pages:history.empty")}
          </p>
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
          <li key={version.id} className="relative flex items-start gap-4">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center bg-background"
            >
              <span className="size-2 rounded-full bg-foreground/25" />
            </span>
            <button
              type="button"
              className={entryClass(selected)}
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(version.id)}
            >
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {formatDateTime(version.lastSavedAt)}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-xs">
                <MemberAvatar
                  name={ownerName}
                  image={owner?.image}
                  className="size-4"
                />
                <span className="truncate font-medium">{ownerName}</span>
                {others > 0 && (
                  <span className="shrink-0 text-muted-foreground">
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
