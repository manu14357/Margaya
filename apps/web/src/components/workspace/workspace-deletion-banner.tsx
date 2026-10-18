import { CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useCancelWorkspaceDeletion } from "@/hooks/mutations/workspace/use-workspace-deletion-mutations";
import useWorkspaceDeletion from "@/hooks/queries/workspace/use-workspace-deletion";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";

/**
 * Shown across the workspace while a deletion is pending: it is read-only
 * until the due date, and its owner can cancel from here.
 */
export default function WorkspaceDeletionBanner({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const { data: deletion } = useWorkspaceDeletion(workspaceId);
  const { canDeleteWorkspace } = useWorkspacePermission();
  const cancel = useCancelWorkspaceDeletion();

  if (!deletion?.pending || !deletion.dueAt) return null;

  return (
    <div className="shrink-0 px-3 pt-3 print:hidden">
      <Alert variant="warning">
        <CalendarClock />
        <AlertTitle>
          {t("settings:workspaceDeletion.bannerTitle", {
            date: formatDateMedium(deletion.dueAt),
          })}
        </AlertTitle>
        <AlertDescription>
          {t("settings:workspaceDeletion.bannerDescription")}
        </AlertDescription>
        {canDeleteWorkspace() && (
          <AlertAction>
            <Button
              size="xs"
              variant="outline"
              loading={cancel.isPending}
              onClick={() =>
                cancel.mutate(workspaceId, {
                  onSuccess: () =>
                    toast.success(
                      t("settings:workspaceDeletion.toastCancelled"),
                    ),
                  onError: (error) =>
                    toast.error(
                      error instanceof Error && error.message
                        ? error.message
                        : t("settings:workspaceDeletion.toastError"),
                    ),
                })
              }
            >
              {t("settings:workspaceDeletion.cancel")}
            </Button>
          </AlertAction>
        )}
      </Alert>
    </div>
  );
}
