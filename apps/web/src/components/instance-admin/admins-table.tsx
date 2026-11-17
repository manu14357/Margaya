import { UserMinus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableHead,
  SettingsTableHeader,
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TruncatedText } from "@/components/ui/truncated-text";
import { useRemoveInstanceAdmin } from "@/hooks/mutations/instance-admin/use-instance-admin-mutations";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import type { InstanceAdmin } from "@/types/instance-admin";

type AdminsTableProps = { admins: InstanceAdmin[] };

/** Instance admins with Remove; the last one can't be removed. */
export function AdminsTable({ admins }: AdminsTableProps) {
  const { t } = useTranslation();
  const { mutateAsync } = useRemoveInstanceAdmin();
  const [pending, setPending] = useState<InstanceAdmin | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isLast = admins.length <= 1;

  const remove = async () => {
    if (!pending) return;
    try {
      await mutateAsync(pending.id);
      toast.success(t("instanceAdmin:admins.removed", { name: pending.name }));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("instanceAdmin:saveError"),
      );
    }
  };

  return (
    <>
      <SettingsTable>
        <SettingsTableHeader>
          <SettingsTableRow>
            <SettingsTableHead>
              {t("instanceAdmin:admins.columns.name")}
            </SettingsTableHead>
            <SettingsTableHead>
              {t("instanceAdmin:admins.columns.email")}
            </SettingsTableHead>
            <SettingsTableHead className="w-16">
              <span className="sr-only">{t("settings:table.actions")}</span>
            </SettingsTableHead>
          </SettingsTableRow>
        </SettingsTableHeader>
        <SettingsTableBody>
          {admins.map((admin) => {
            const removeButton = (
              // An icon: the label is long in several languages and would
              // not fit the actions column.
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={isLast}
                aria-label={t("instanceAdmin:admins.remove")}
                onClick={() => {
                  setPending(admin);
                  setConfirmOpen(true);
                }}
              >
                <UserMinus />
              </Button>
            );
            return (
              <SettingsTableRow key={admin.id}>
                <SettingsTableCell kind="primary">
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar className="size-7 shrink-0">
                      <AvatarImage src={admin.image ?? ""} alt="" />
                      <AvatarFallback className="text-[10px]">
                        {getInitials(admin.name || admin.email)}
                      </AvatarFallback>
                    </Avatar>
                    <TruncatedText
                      text={admin.name}
                      className="font-medium text-sm"
                    />
                    {admin.isYou && (
                      <Badge variant="secondary" size="sm" className="shrink-0">
                        {t("instanceAdmin:admins.you")}
                      </Badge>
                    )}
                  </div>
                </SettingsTableCell>
                <SettingsTableCell
                  label={t("instanceAdmin:admins.columns.email")}
                  className="text-muted-foreground"
                >
                  <TruncatedText text={admin.email} middle />
                </SettingsTableCell>
                <SettingsTableCell kind="actions">
                  {isLast ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger
                          render={<span className="inline-flex" />}
                        >
                          {removeButton}
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("instanceAdmin:admins.lastAdmin")}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger render={removeButton} />
                      <TooltipContent>
                        {t("instanceAdmin:admins.remove")}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </SettingsTableCell>
              </SettingsTableRow>
            );
          })}
        </SettingsTableBody>
      </SettingsTable>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("instanceAdmin:admins.removeTitle", {
                name: pending?.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("instanceAdmin:admins.removeDescription")}
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
                  onClick={() => void remove()}
                />
              }
            >
              {t("instanceAdmin:admins.removeConfirm")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
