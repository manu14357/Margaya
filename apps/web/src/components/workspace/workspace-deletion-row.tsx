import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsRow } from "@/components/settings-layout";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  useCancelWorkspaceDeletion,
  useScheduleWorkspaceDeletion,
} from "@/hooks/mutations/workspace/use-workspace-deletion-mutations";
import useWorkspaceDeletion from "@/hooks/queries/workspace/use-workspace-deletion";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";

const DAY_MS = 24 * 60 * 60 * 1000;

type WorkspaceDeletionRowProps = {
  workspaceId: string;
  workspaceName: string;
  /** workspace:delete (owners by default). */
  canDelete: boolean;
};

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The danger-zone row for deleting the workspace. Deleting schedules it:
 * the workspace stays read-only for the grace period, and the owner can
 * cancel until then.
 */
export default function WorkspaceDeletionRow({
  workspaceId,
  workspaceName,
  canDelete,
}: WorkspaceDeletionRowProps) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data: deletion } = useWorkspaceDeletion(workspaceId);
  const schedule = useScheduleWorkspaceDeletion();
  const cancel = useCancelWorkspaceDeletion();

  const graceDays = deletion?.graceDays ?? 14;
  const plannedDate = formatDateMedium(
    new Date(Date.now() + graceDays * DAY_MS),
  );

  if (deletion?.pending && deletion.dueAt) {
    return (
      <SettingsRow
        label={t("settings:workspaceDeletion.pendingTitle")}
        description={t("settings:workspaceDeletion.pendingDescription", {
          date: formatDateMedium(deletion.dueAt),
        })}
      >
        {canDelete && (
          <Button
            variant="outline"
            size="sm"
            type="button"
            loading={cancel.isPending}
            onClick={() =>
              cancel.mutate(workspaceId, {
                onSuccess: () =>
                  toast.success(t("settings:workspaceDeletion.toastCancelled")),
                onError: (error) =>
                  toast.error(
                    errorText(
                      error,
                      t("settings:workspaceDeletion.toastError"),
                    ),
                  ),
              })
            }
          >
            {t("settings:workspaceDeletion.cancel")}
          </Button>
        )}
      </SettingsRow>
    );
  }

  if (!canDelete) return null;

  return (
    <>
      <SettingsRow
        label={t("settings:workspaceGeneral.deleteWorkspace")}
        description={t("settings:workspaceDeletion.rowDescription", {
          date: plannedDate,
        })}
      >
        <Button
          variant="destructive-outline"
          size="sm"
          type="button"
          onClick={() => setConfirmOpen(true)}
        >
          {t("settings:workspaceGeneral.deleteWorkspace")}
        </Button>
      </SettingsRow>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:workspaceDeletion.dialogTitle", {
                name: workspaceName,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:workspaceDeletion.dialogDescription", {
                name: workspaceName,
                date: plannedDate,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              size="sm"
              loading={schedule.isPending}
              onClick={() =>
                schedule.mutate(workspaceId, {
                  onSuccess: (state) => {
                    setConfirmOpen(false);
                    toast.success(
                      t("settings:workspaceDeletion.toastScheduled", {
                        date: state.dueAt
                          ? formatDateMedium(state.dueAt)
                          : plannedDate,
                      }),
                    );
                  },
                  onError: (error) =>
                    toast.error(
                      errorText(
                        error,
                        t("settings:workspaceDeletion.toastError"),
                      ),
                    ),
                })
              }
            >
              {t("settings:workspaceDeletion.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
