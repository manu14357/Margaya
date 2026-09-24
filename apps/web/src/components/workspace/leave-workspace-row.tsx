import { useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
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
import useLeaveWorkspace, {
  LAST_OWNER_CODE,
  LeaveWorkspaceError,
} from "@/hooks/mutations/workspace/use-leave-workspace";
import { toast } from "@/lib/toast";

type Member = { userId: string; role: string };

type LeaveWorkspaceRowProps = {
  workspaceId: string;
  workspaceName: string;
  currentUserId: string | undefined;
  members: Member[];
};

const isOwnerRole = (role: string) =>
  role
    .split(",")
    .map((part) => part.trim())
    .includes("owner");

/**
 * "Leave workspace" with a confirmation. The last owner sees why they can't
 * leave; the server refuses them too. Afterwards the dashboard picks another
 * workspace, or onboarding when there is none.
 */
export function LeaveWorkspaceRow({
  workspaceId,
  workspaceName,
  currentUserId,
  members,
}: LeaveWorkspaceRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { mutateAsync: leave, isPending } = useLeaveWorkspace();

  const me = members.find((member) => member.userId === currentUserId);
  const ownerCount = members.filter((member) =>
    isOwnerRole(member.role),
  ).length;
  const isLastOwner = Boolean(me && isOwnerRole(me.role) && ownerCount <= 1);

  const handleLeave = async () => {
    try {
      await leave({ workspaceId });
      toast.success(
        t("settings:workspaceGeneral.leave.success", { name: workspaceName }),
      );
      navigate({ to: "/dashboard" });
    } catch (error) {
      if (
        error instanceof LeaveWorkspaceError &&
        error.code === LAST_OWNER_CODE
      ) {
        toast.error(t("settings:workspaceGeneral.leave.lastOwner"));
        return;
      }
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("settings:workspaceGeneral.leave.error"),
      );
    }
  };

  return (
    <>
      <SettingsRow
        label={t("settings:workspaceGeneral.leave.title")}
        description={t("settings:workspaceGeneral.leave.description")}
        note={
          isLastOwner
            ? t("settings:workspaceGeneral.leave.lastOwner")
            : undefined
        }
      >
        <Button
          variant="destructive-outline"
          size="sm"
          type="button"
          disabled={isLastOwner || isPending}
          onClick={() => setOpen(true)}
        >
          <LogOut className="size-4" aria-hidden />
          {t("settings:workspaceGeneral.leave.confirm")}
        </Button>
      </SettingsRow>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:workspaceGeneral.leave.dialogTitle", {
                name: workspaceName,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:workspaceGeneral.leave.dialogDescription", {
                name: workspaceName,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" size="sm" disabled={isPending} />
              }
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isPending}
                  onClick={handleLeave}
                />
              }
            >
              {isPending
                ? t("settings:workspaceGeneral.leave.leaving")
                : t("settings:workspaceGeneral.leave.confirm")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
