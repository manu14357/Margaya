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
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SignInMethod, SignInMethodStatus } from "@/lib/instance-settings";
import { SourceBadge } from "./source-badge";

const STATUS: Record<
  SignInMethodStatus,
  {
    labelKey: string;
    variant: "success" | "outline" | "warning";
  }
> = {
  active: { labelKey: "instanceAdmin:auth.status.active", variant: "success" },
  off: { labelKey: "instanceAdmin:auth.status.off", variant: "outline" },
  notConfigured: {
    labelKey: "instanceAdmin:auth.status.notConfigured",
    variant: "outline",
  },
  needsEmail: {
    labelKey: "instanceAdmin:auth.status.needsEmail",
    variant: "warning",
  },
};

type SignInMethodCardProps = {
  method: SignInMethod;
  name: string;
  hint: string;
  icon: React.ReactNode;
  pending?: boolean;
  onToggle: (enabled: boolean) => void;
  onConfigure?: () => void;
};

/**
 * One sign-in method: status, an enable switch and, for OAuth providers,
 * Configure. The last working method can't be turned off, and turning off a
 * provider asks first.
 */
export function SignInMethodCard({
  method,
  name,
  hint,
  icon,
  pending = false,
  onToggle,
  onConfigure,
}: SignInMethodCardProps) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const status = STATUS[method.status];
  const blockedAsLast = method.enabled && method.isLastActive;
  const switchId = `sign-in-method-${method.id}`;

  const handleChange = (next: boolean) => {
    if (!next && method.isProvider) {
      setConfirmOpen(true);
      return;
    }
    onToggle(next);
  };

  const toggle = (
    <Switch
      id={switchId}
      aria-label={t("instanceAdmin:auth.toggle", { method: name })}
      checked={method.enabled}
      disabled={method.locked || blockedAsLast || pending}
      onCheckedChange={handleChange}
    />
  );

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
          {icon}
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{name}</span>
            <Badge
              variant={status.variant}
              size="sm"
              className={
                status.variant === "outline"
                  ? "text-muted-foreground"
                  : undefined
              }
            >
              {t(status.labelKey)}
            </Badge>
            {method.envVar && (
              <SourceBadge
                entry={{
                  source: "environment",
                  envVar: method.envVar,
                  updatedAt: null,
                  updatedBy: null,
                }}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
        {onConfigure && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onConfigure}
          >
            {t("instanceAdmin:auth.configure")}
          </Button>
        )}
        {blockedAsLast && !method.locked ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                {toggle}
              </TooltipTrigger>
              <TooltipContent>
                {t("instanceAdmin:auth.lastMethod")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          toggle
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("instanceAdmin:auth.disableTitle", { provider: name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("instanceAdmin:auth.disableDescription", { provider: name })}
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
                  onClick={() => onToggle(false)}
                />
              }
            >
              {t("instanceAdmin:auth.disableConfirm")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
