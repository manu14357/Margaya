import { useNavigate } from "@tanstack/react-router";
import { EllipsisVertical, ExternalLink, Globe, Settings } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableHead,
  SettingsTableHeader,
  SettingsTableMeta,
  SettingsTableRow,
} from "@/components/settings/settings-table";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompactDate } from "@/components/ui/compact-date";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { useUnpublishInstanceBoard } from "@/hooks/mutations/instance-admin/use-instance-admin-mutations";
import { useInstancePublicBoards } from "@/hooks/queries/instance-admin/use-instance-admin";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";
import type { InstancePublicBoard } from "@/types/instance-admin";
import { InstanceLoadState } from "./instance-page";

const FEATURE_LABELS = {
  comments: "instanceAdmin:publicBoards.feature.comments",
  reactions: "instanceAdmin:publicBoards.feature.reactions",
  votes: "instanceAdmin:publicBoards.feature.votes",
  requests: "instanceAdmin:publicBoards.feature.requests",
  guests: "instanceAdmin:publicBoards.feature.guests",
} as const satisfies Record<keyof InstancePublicBoard["features"], string>;

type PublicBoardsTableProps = { q: string };

/** Every published board on the instance, with Open, settings, Unpublish. */
export function PublicBoardsTable({ q }: PublicBoardsTableProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const query = useInstancePublicBoards(q);
  const { mutateAsync: unpublish } = useUnpublishInstanceBoard();
  const [pending, setPending] = useState<InstancePublicBoard | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  const openSettings = async (board: InstancePublicBoard) => {
    // Project settings read the active workspace.
    try {
      await authClient.organization.setActive({
        organizationId: board.workspaceId,
      });
    } catch {}
    navigate({
      to: "/dashboard/settings/projects/$projectId/visibility",
      params: { projectId: board.projectId },
    });
  };

  const handleUnpublish = async () => {
    if (!pending) return;
    try {
      await unpublish(pending.projectId);
      toast.success(t("instanceAdmin:publicBoards.unpublished"));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("instanceAdmin:publicBoards.unpublishError"),
      );
    }
  };

  if (!query.data) {
    return (
      <InstanceLoadState
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  if (items.length === 0) {
    return (
      <p className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        <Globe className="size-5" aria-hidden />
        {q.trim()
          ? t("instanceAdmin:publicBoards.noMatches", { query: q.trim() })
          : t("instanceAdmin:publicBoards.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <SettingsTable>
        <SettingsTableHeader>
          <SettingsTableRow>
            <SettingsTableHead>
              {t("instanceAdmin:publicBoards.columns.project")}
            </SettingsTableHead>
            <SettingsTableHead>
              {t("instanceAdmin:publicBoards.columns.workspace")}
            </SettingsTableHead>
            <SettingsTableHead className="w-32" hideBelow="md">
              {t("instanceAdmin:publicBoards.columns.published")}
            </SettingsTableHead>
            <SettingsTableHead>
              {t("instanceAdmin:publicBoards.columns.features")}
            </SettingsTableHead>
            <SettingsTableHead className="w-14">
              <span className="sr-only">
                {t("instanceAdmin:publicBoards.actions")}
              </span>
            </SettingsTableHead>
          </SettingsTableRow>
        </SettingsTableHeader>
        <SettingsTableBody>
          {items.map((board) => {
            const features = (
              Object.keys(FEATURE_LABELS) as Array<keyof typeof FEATURE_LABELS>
            ).filter((feature) => board.features[feature]);
            return (
              <SettingsTableRow key={board.projectId}>
                <SettingsTableCell kind="primary" className="font-medium">
                  {board.projectName}
                  <SettingsTableMeta hideAbove="md" className="font-normal">
                    <span>
                      {t("instanceAdmin:publicBoards.columns.published")}{" "}
                      <CompactDate value={board.publishedAt} />
                    </span>
                  </SettingsTableMeta>
                </SettingsTableCell>
                <SettingsTableCell
                  label={t("instanceAdmin:publicBoards.columns.workspace")}
                  className="text-muted-foreground"
                >
                  {board.workspaceName}
                </SettingsTableCell>
                <SettingsTableCell
                  hideBelow="md"
                  className="text-muted-foreground"
                >
                  <CompactDate value={board.publishedAt} />
                </SettingsTableCell>
                <SettingsTableCell
                  label={t("instanceAdmin:publicBoards.columns.features")}
                >
                  <div className="flex flex-wrap gap-1">
                    {features.map((feature) => (
                      <Badge key={feature} variant="outline" size="sm">
                        {t(FEATURE_LABELS[feature])}
                      </Badge>
                    ))}
                  </div>
                </SettingsTableCell>
                <SettingsTableCell kind="actions">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("instanceAdmin:publicBoards.actions")}
                        />
                      }
                    >
                      <EllipsisVertical />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() =>
                          window.open(board.path, "_blank", "noopener")
                        }
                      >
                        <ExternalLink />
                        {t("instanceAdmin:publicBoards.openBoard")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => void openSettings(board)}
                      >
                        <Settings />
                        {t("instanceAdmin:publicBoards.projectSettings")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => {
                          setPending(board);
                          setConfirmOpen(true);
                        }}
                      >
                        {t("instanceAdmin:publicBoards.unpublish")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SettingsTableCell>
              </SettingsTableRow>
            );
          })}
        </SettingsTableBody>
      </SettingsTable>
      {query.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("instanceAdmin:publicBoards.loadMore")}
        </Button>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("instanceAdmin:publicBoards.unpublishTitle", {
                project: pending?.projectName ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("instanceAdmin:publicBoards.unpublishDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleUnpublish()}
                />
              }
            >
              {t("instanceAdmin:publicBoards.unpublishConfirm")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
