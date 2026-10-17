import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { InstanceUser } from "@/types/instance-admin";

const DURATIONS = ["forever", "7", "30"] as const;
type Duration = (typeof DURATIONS)[number];

const DURATION_KEYS: Record<Duration, string> = {
  forever: "accountSecurity:platform.users.banForever",
  "7": "accountSecurity:platform.users.ban7Days",
  "30": "accountSecurity:platform.users.ban30Days",
};

type BanUserDialogProps = {
  user: InstanceUser;
  onClose: () => void;
  /** Resolves to whether the ban went through. */
  onConfirm: (reason: string, expiresInDays: number | null) => Promise<boolean>;
};

/** Ban an account, for good or for some days; it is signed out at once. */
export function BanUserDialog({
  user,
  onClose,
  onConfirm,
}: BanUserDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState<Duration>("forever");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const done = await onConfirm(
      reason.trim(),
      duration === "forever" ? null : Number(duration),
    );
    setBusy(false);
    if (done) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("accountSecurity:platform.users.banTitle", { name: user.name })}
          </DialogTitle>
          <DialogDescription>
            {t("accountSecurity:platform.users.banDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 pb-2">
          <div className="space-y-1.5">
            <Label htmlFor="ban-reason">
              {t("accountSecurity:platform.users.banReason")}
            </Label>
            <Textarea
              id="ban-reason"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">
              {t("accountSecurity:platform.users.banDuration")}
            </legend>
            <RadioGroup
              value={duration}
              onValueChange={(value) => setDuration(value as Duration)}
              className="gap-2"
            >
              {DURATIONS.map((option) => (
                <Label
                  key={option}
                  className="flex items-center gap-2 font-normal"
                >
                  <Radio value={option} />
                  {t(DURATION_KEYS[option])}
                </Label>
              ))}
            </RadioGroup>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="destructive"
            loading={busy}
            onClick={() => void submit()}
          >
            {t("accountSecurity:platform.users.ban")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ResetPasswordDialogProps = {
  user: InstanceUser;
  onClose: () => void;
  /** No password: email a reset link. Resolves to whether it worked. */
  onConfirm: (password?: string) => Promise<boolean>;
};

/** Email a reset link, or set a password now and sign the account out. */
export function ResetPasswordDialog({
  user,
  onClose,
  onConfirm,
}: ResetPasswordDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"email" | "set">("email");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const done = await onConfirm(mode === "set" ? password : undefined);
    setBusy(false);
    if (done) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("accountSecurity:platform.users.resetTitle", {
              name: user.name,
            })}
          </DialogTitle>
          <DialogDescription>
            {t("accountSecurity:platform.users.resetDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 pb-2">
          <RadioGroup
            value={mode}
            onValueChange={(value) => setMode(value as "email" | "set")}
            className="gap-2"
          >
            <Label className="flex items-center gap-2 font-normal">
              <Radio value="email" />
              {t("accountSecurity:platform.users.resetByEmail", {
                email: user.email,
              })}
            </Label>
            <Label className="flex items-center gap-2 font-normal">
              <Radio value="set" />
              {t("accountSecurity:platform.users.resetSetNow")}
            </Label>
          </RadioGroup>
          {mode === "set" && (
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">
                {t("accountSecurity:platform.users.newPassword")}
              </Label>
              <Input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("accountSecurity:password.hint", { min: 10 })}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            loading={busy}
            disabled={mode === "set" && password.length === 0}
            onClick={() => void submit()}
          >
            {t("accountSecurity:platform.users.resetConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
