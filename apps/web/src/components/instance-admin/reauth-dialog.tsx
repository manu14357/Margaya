import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PasswordInput } from "@/components/auth/password-input";
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
import { Label } from "@/components/ui/label";
import { useConfirmInstanceAdminPassword } from "@/hooks/mutations/instance-admin/use-instance-admin-mutations";
import useSignOut from "@/hooks/mutations/use-sign-out";
import useAccountSecurity from "@/hooks/queries/user/use-account-security";
import { isWrongPassword, useReauthStore } from "@/lib/reauth";

/**
 * Asks for the password when an instance change needs a recent sign-in.
 * Accounts without a password (social, OIDC, email codes) sign in again.
 */
export function ReauthDialog() {
  const open = useReauthStore((state) => state.open);
  // Mounted only while asked, so pages don't load the account state for it.
  return open ? <ReauthDialogBody /> : null;
}

function ReauthDialogBody() {
  const { t } = useTranslation();
  const settle = useReauthStore((state) => state.settle);
  const security = useAccountSecurity();
  const confirm = useConfirmInstanceAdminPassword();
  const signOut = useSignOut();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hasPassword = security.data?.hasPassword !== false;

  const close = (confirmed: boolean) => {
    setPassword("");
    setError(null);
    settle(confirmed);
  };

  const submit = async () => {
    if (!password) return;
    setError(null);
    try {
      await confirm.mutateAsync(password);
      close(true);
    } catch (failure) {
      setError(
        isWrongPassword(failure)
          ? t("accountSecurity:reauth.wrongPassword")
          : t("accountSecurity:reauth.error"),
      );
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && close(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("accountSecurity:reauth.title")}</DialogTitle>
          <DialogDescription>
            {hasPassword
              ? t("accountSecurity:reauth.description")
              : t("accountSecurity:reauth.noPassword")}
          </DialogDescription>
        </DialogHeader>
        {hasPassword ? (
          <DialogPanel>
            <form
              id="instance-reauth"
              className="space-y-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <Label htmlFor="instance-reauth-password">
                {t("accountSecurity:reauth.password")}
              </Label>
              <PasswordInput
                id="instance-reauth-password"
                autoComplete="current-password"
                autoFocus
                value={password}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "instance-reauth-error" : undefined}
                onChange={(event) => setPassword(event.target.value)}
              />
              {error ? (
                <p
                  id="instance-reauth-error"
                  role="alert"
                  className="text-xs text-destructive-foreground"
                >
                  {error}
                </p>
              ) : null}
            </form>
          </DialogPanel>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {t("common:actions.cancel")}
          </Button>
          {hasPassword ? (
            <Button
              type="submit"
              form="instance-reauth"
              disabled={!password}
              loading={confirm.isPending}
            >
              {t("accountSecurity:reauth.confirm")}
            </Button>
          ) : (
            <Button
              type="button"
              loading={signOut.isPending}
              onClick={() => {
                close(false);
                signOut.mutate();
              }}
            >
              {t("accountSecurity:reauth.signInAgain")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
