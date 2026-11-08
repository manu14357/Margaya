import { CheckCircle, Trash2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PushDevice } from "@/fetchers/notification-preferences/get-push-status";
import {
  useRemovePushDevice,
  useTurnOffPush,
  useTurnOnPush,
} from "@/hooks/mutations/notification-preferences/use-push-subscription";
import useGetPushStatus from "@/hooks/queries/notification-preferences/use-get-push-status";
import {
  getPushPermission,
  getPushSupport,
  registerPushWorker,
} from "@/lib/push";
import { summarizeUserAgent } from "@/lib/user-agent";

/** Turns push on or off for this device and lists the account's other ones. */
export function PushNotificationCard() {
  const { t } = useTranslation();
  const switchId = React.useId();
  const { data: status, isError, isLoading } = useGetPushStatus();
  const turnOn = useTurnOnPush();
  const turnOff = useTurnOffPush();
  const removeDevice = useRemovePushDevice();

  const support = getPushSupport();
  const isOn = Boolean(status?.thisDevice);
  const permission =
    support === "supported" ? getPushPermission() : ("default" as const);
  // Off and blocked: the switch can't help. On and blocked: it can still be
  // turned off, but this device no longer shows what it receives.
  const isBlocked = !isOn && permission === "denied";
  const canSubscribe = Boolean(status?.available) && support === "supported";

  React.useEffect(() => {
    if (canSubscribe) void registerPushWorker().catch(() => {});
  }, [canSubscribe]);

  const hint = () => {
    if (isError) return t("settings:notificationsPage.pushLoadFailed");
    if (!status?.available) return t("settings:notificationsPage.pushNotSetUp");
    if (support === "install-required") {
      return t("settings:notificationsPage.pushInstallFirst");
    }
    if (support === "unsupported") {
      return t("settings:notificationsPage.pushUnsupported");
    }
    if (permission === "denied") {
      return t("settings:notificationsPage.pushBlocked");
    }
    if (isOn) return t("settings:notificationsPage.pushOnHint");
    // The browser asks only while permission is undecided.
    return permission === "granted"
      ? t("settings:notificationsPage.pushOffHintAllowed")
      : t("settings:notificationsPage.pushOffHint");
  };

  const deviceLabel = (device: PushDevice) => {
    const { browser, os } = summarizeUserAgent(device.userAgent);
    if (browser && os) {
      return t("settings:securityPage.sessions.deviceLabel", { browser, os });
    }
    return browser ?? os ?? t("settings:securityPage.sessions.unknownDevice");
  };

  const isBusy = turnOn.isPending || turnOff.isPending;

  return (
    <div
      className="flex flex-col rounded-lg border bg-card"
      data-channel="push"
    >
      <div className="flex items-start justify-between gap-4 px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <h3 className="font-medium text-sm">
            {t("settings:notificationsPage.pushTitle")}
          </h3>
          <p className="text-muted-foreground text-xs">
            {t("settings:notificationsPage.pushDescription")}
          </p>
        </div>
        {isOn ? (
          <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="size-4 text-green-600" />
            <span>{t("settings:notificationsPage.statusConnected")}</span>
          </div>
        ) : null}
      </div>
      <div className="space-y-4 border-t px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 space-y-0.5">
            <Label className="text-sm font-medium" htmlFor={switchId}>
              {t("settings:notificationsPage.pushThisDevice")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {isLoading ? null : hint()}
            </p>
          </div>
          <Switch
            checked={isOn}
            disabled={!canSubscribe || isBlocked || isBusy}
            id={switchId}
            onCheckedChange={(checked) => {
              if (!checked) turnOff.mutate();
              else if (status?.publicKey) turnOn.mutate(status.publicKey);
            }}
          />
        </div>

        {status?.otherDevices.length ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {t("settings:notificationsPage.pushOtherDevices")}
            </p>
            <ul className="space-y-1">
              {status.otherDevices.map((device) => {
                const label = deviceLabel(device);
                return (
                  <li
                    className="flex items-center justify-between gap-4 text-sm"
                    key={device.id}
                  >
                    <span className="min-w-0 truncate">{label}</span>
                    <Button
                      aria-label={t(
                        "settings:notificationsPage.pushRemoveDeviceLabel",
                        { device: label },
                      )}
                      disabled={removeDevice.isPending}
                      onClick={() => removeDevice.mutate(device.id)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Trash2 className="size-4" />
                      {t("settings:notificationsPage.pushRemoveDevice")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
