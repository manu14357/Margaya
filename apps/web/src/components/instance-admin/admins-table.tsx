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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("instanceAdmin:admins.columns.name")}</TableHead>
              <TableHead>{t("instanceAdmin:admins.columns.email")}</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {admins.map((admin) => {
              const removeButton = (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={isLast}
                  onClick={() => {
                    setPending(admin);
                    setConfirmOpen(true);
                  }}
                >
                  {t("instanceAdmin:admins.remove")}
                </Button>
              );
              return (
                <TableRow key={admin.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="size-7">
                        <AvatarImage src={admin.image ?? ""} alt="" />
                        <AvatarFallback className="text-[10px]">
                          {getInitials(admin.name || admin.email)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">{admin.name}</span>
                      {admin.isYou && (
                        <Badge variant="secondary" size="sm">
                          {t("instanceAdmin:admins.you")}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {admin.email}
                  </TableCell>
                  <TableCell>
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
                      removeButton
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

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
