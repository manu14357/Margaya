import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPage } from "@/components/settings-layout";

type WebhookPageShellProps = {
  allowed: boolean;
  isCheckingPermissions: boolean;
  /** Defaults to "Webhooks". */
  title?: ReactNode;
  documentTitle?: string;
  /** Defaults to the Webhooks subtitle. */
  description?: ReactNode;
  eyebrow?: ReactNode;
  /** Shown only with the capability. */
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * The Webhooks page frame. Without workspace:manage_settings it shows the
 * same muted note the roles page uses, and nothing interactive renders
 * while the capability check is in flight.
 */
export function WebhookPageShell({
  allowed,
  isCheckingPermissions,
  title,
  documentTitle,
  description,
  eyebrow,
  actions,
  children,
}: WebhookPageShellProps) {
  const { t } = useTranslation();
  const denied = !isCheckingPermissions && !allowed;
  return (
    <SettingsPage
      title={title ?? t("settings:workspaceWebhooks.title")}
      documentTitle={documentTitle ?? t("settings:workspaceWebhooks.pageTitle")}
      description={
        denied
          ? t("settings:workspaceWebhooks.noPermission")
          : (description ?? t("settings:workspaceWebhooks.subtitle"))
      }
      eyebrow={allowed ? eyebrow : undefined}
      actions={allowed ? actions : undefined}
    >
      {allowed && children}
    </SettingsPage>
  );
}

export default WebhookPageShell;
