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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { usePublicBoardRequestMutations } from "@/hooks/mutations/public-board/use-public-board-requests";
import { useMyPublicBoardRequests } from "@/hooks/queries/public-board/use-public-board-task";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";
import type { PublicRequest, PublicRequestStatus } from "@/types/public-board";

const STATUS: Record<
  PublicRequestStatus,
  { key: string; variant: "info" | "success" | "error" | "secondary" }
> = {
  in_review: {
    key: "publicProject:myRequests.status.in_review",
    variant: "info",
  },
  accepted: {
    key: "publicProject:myRequests.status.accepted",
    variant: "success",
  },
  declined: {
    key: "publicProject:myRequests.status.declined",
    variant: "error",
  },
  duplicate: {
    key: "publicProject:myRequests.status.duplicate",
    variant: "secondary",
  },
};

type MyRequestsSheetProps = {
  token: string;
  enabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViewTask: (number: number) => void;
};

/** My requests to this board, newest first, with their outcome. */
export default function MyRequestsSheet({
  token,
  enabled,
  open,
  onOpenChange,
  onViewTask,
}: MyRequestsSheetProps) {
  const { t } = useTranslation();
  const requests = useMyPublicBoardRequests(token, enabled && open);
  const { withdraw } = usePublicBoardRequestMutations(token);
  const [withdrawing, setWithdrawing] = useState<PublicRequest | null>(null);
  const items = requests.data?.pages.flatMap((page) => page.items) ?? [];

  const confirmWithdraw = () => {
    if (!withdrawing) return;
    withdraw.mutate(withdrawing.id, {
      onSuccess: () => toast.success(t("publicProject:myRequests.withdrawn")),
      onError: (error) =>
        toast.error(
          error.message || t("publicProject:myRequests.withdrawError"),
        ),
    });
    setWithdrawing(null);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>{t("publicProject:myRequests.title")}</SheetTitle>
        </SheetHeader>
        <SheetPanel>
          {requests.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : requests.isError ? (
            <div className="flex items-center gap-3 text-muted-foreground text-sm">
              <span>{t("publicProject:myRequests.error")}</span>
              <Button
                variant="outline"
                size="xs"
                onClick={() => void requests.refetch()}
              >
                {t("settings:projectPublish.retry")}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("publicProject:myRequests.empty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((request) => {
                const status = STATUS[request.status];
                return (
                  <li
                    key={request.id}
                    className="space-y-1.5 rounded-lg border border-border bg-card px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 break-words font-medium text-sm">
                        {request.title}
                      </p>
                      <Badge variant={status.variant} size="sm">
                        {t(status.key)}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {t("publicProject:myRequests.sent", {
                        date: formatDateMedium(request.createdAt),
                      })}
                    </p>
                    {request.status === "declined" && request.note && (
                      <p className="text-muted-foreground text-xs">
                        {t("publicProject:myRequests.reason", {
                          note: request.note,
                        })}
                      </p>
                    )}
                    {request.status === "duplicate" &&
                      request.boardTaskNumber === null && (
                        <p className="text-muted-foreground text-xs">
                          {t("publicProject:myRequests.alreadyCovered")}
                        </p>
                      )}
                    <div className="flex flex-wrap gap-2">
                      {request.boardTaskNumber !== null &&
                        (request.status === "accepted" ||
                          request.status === "duplicate") && (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => {
                              if (request.boardTaskNumber === null) return;
                              onOpenChange(false);
                              onViewTask(request.boardTaskNumber);
                            }}
                          >
                            {t("publicProject:myRequests.viewOnBoard")}
                          </Button>
                        )}
                      {request.canWithdraw && (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-destructive-foreground"
                          onClick={() => setWithdrawing(request)}
                        >
                          {t("publicProject:myRequests.withdraw")}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {requests.hasNextPage && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              disabled={requests.isFetchingNextPage}
              onClick={() => void requests.fetchNextPage()}
            >
              {t("publicProject:myRequests.loadMore")}
            </Button>
          )}
        </SheetPanel>
      </SheetContent>

      <AlertDialog
        open={withdrawing !== null}
        onOpenChange={(next) => {
          if (!next) setWithdrawing(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("publicProject:myRequests.withdrawTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("publicProject:myRequests.withdrawDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button variant="destructive" size="sm" onClick={confirmWithdraw}>
              {t("publicProject:myRequests.withdrawConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
