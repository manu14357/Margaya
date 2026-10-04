import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAddInstanceAdmin } from "@/hooks/mutations/instance-admin/use-instance-admin-mutations";
import { isValidEmail } from "@/lib/instance-settings";
import { toast } from "@/lib/toast";

type AddAdminDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Promote an existing account, by email, to instance admin. */
export function AddAdminDialog({ open, onOpenChange }: AddAdminDialogProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const { mutateAsync, isPending } = useAddInstanceAdmin();
  const valid = isValidEmail(email);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) setEmail("");
  };

  const submit = async () => {
    if (!valid) return;
    try {
      const admin = await mutateAsync(email.trim());
      toast.success(t("instanceAdmin:admins.added", { name: admin.name }));
      close(false);
    } catch (error) {
      // 404 unknown email, 400 guest or banned: the server explains.
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("instanceAdmin:saveError"),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("instanceAdmin:admins.addTitle")}</DialogTitle>
          <DialogDescription>
            {t("instanceAdmin:admins.addDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id="add-instance-admin"
            className="space-y-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Label htmlFor="add-admin-email">
              {t("instanceAdmin:admins.email")}
            </Label>
            <Input
              id="add-admin-email"
              type="email"
              autoComplete="off"
              placeholder={t("instanceAdmin:admins.emailPlaceholder")}
              value={email}
              aria-invalid={(email !== "" && !valid) || undefined}
              onChange={(event) => setEmail(event.target.value)}
            />
            {email !== "" && !valid && (
              <p className="text-xs text-destructive-foreground">
                {t("instanceAdmin:admins.emailInvalid")}
              </p>
            )}
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            type="submit"
            form="add-instance-admin"
            disabled={!valid}
            loading={isPending}
          >
            {t("instanceAdmin:admins.addConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
