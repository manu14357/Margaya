import { useNavigate } from "@tanstack/react-router";
import { EllipsisVertical, ExternalLink, Globe, Settings } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUnpublishInstanceBoard } from "@/hooks/mutations/instance-admin/use-instance-admin-mutations";
import { useInstancePublicBoards } from "@/hooks/queries/instance-admin/use-instance-admin";
import { authClient } from "@/lib/auth-client";
import { formatDateMedium } from "@/lib/format";
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
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {t("instanceAdmin:publicBoards.columns.project")}
              </TableHead>
              <TableHead>
                {t("instanceAdmin:publicBoards.columns.workspace")}
              </TableHead>
              <TableHead>
                {t("instanceAdmin:publicBoards.columns.published")}
              </TableHead>
              <TableHead>
                {t("instanceAdmin:publicBoards.columns.features")}
              </TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((board) => {
              const features = (
                Object.keys(FEATURE_LABELS) as Array<
                  keyof typeof FEATURE_LABELS
                >
              ).filter((feature) => board.features[feature]);
              return (
                <TableRow key={board.projectId}>
                  <TableCell className="font-medium">
                    {board.projectName}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {board.workspaceName}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateMedium(board.publishedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {features.map((feature) => (
                        <Badge key={feature} variant="outline" size="sm">
                          {t(FEATURE_LABELS[feature])}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
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
