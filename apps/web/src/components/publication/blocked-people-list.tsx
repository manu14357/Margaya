import { UserX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePublicCommentModeration } from "@/hooks/mutations/publication/use-public-comment-moderation";
import { usePublicationBlocks } from "@/hooks/queries/publication/use-publication";
import { formatDateMedium } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import AuthorKindBadge from "./author-kind-badge";

/** People blocked from taking part on the board, with Unblock. */
export default function BlockedPeopleList({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const blocks = usePublicationBlocks(projectId, true);
  const { unblock } = usePublicCommentModeration(projectId);
  const rows = blocks.data ?? [];

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">
        {t("settings:projectPublish.moderation.blockedTitle")}
      </h3>
      <div className="rounded-md border border-border bg-sidebar">
        {blocks.isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : blocks.isError ? (
          <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
            <span>{t("settings:projectPublish.loadError")}</span>
            <Button
              variant="outline"
              size="xs"
              onClick={() => void blocks.refetch()}
            >
              {t("settings:projectPublish.retry")}
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <UserX className="size-4" />
            {t("settings:projectPublish.moderation.blockedEmpty")}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li
                key={row.userId}
                className="flex items-center gap-3 px-3 py-2"
              >
                <Avatar className="size-6">
                  <AvatarImage src={row.image ?? ""} alt="" />
                  <AvatarFallback className="text-[10px]">
                    {getInitials(row.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {row.name}
                    </span>
                    <AuthorKindBadge kind={row.kind} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.blockedBy
                      ? `${t("settings:projectPublish.moderation.blockedBy", {
                          name: row.blockedBy.name,
                        })} · ${formatDateMedium(row.createdAt)}`
                      : formatDateMedium(row.createdAt)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={unblock.isPending}
                  onClick={() =>
                    unblock.mutate(row.userId, {
                      onSuccess: () =>
                        toast.success(
                          t("settings:projectPublish.moderation.unblocked", {
                            name: row.name,
                          }),
                        ),
                      onError: (error) =>
                        toast.error(
                          error.message ||
                            t("settings:projectPublish.moderation.actionError"),
                        ),
                    })
                  }
                >
                  {t("settings:projectPublish.moderation.unblock")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
