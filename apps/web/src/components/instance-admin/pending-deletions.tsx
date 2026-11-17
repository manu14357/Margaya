import { useTranslation } from "react-i18next";
import {
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableHead,
  SettingsTableHeader,
  SettingsTableRow,
} from "@/components/settings/settings-table";
import { TruncatedText } from "@/components/ui/truncated-text";
import { useInstancePendingDeletions } from "@/hooks/queries/instance-admin/use-instance-admin";
import { formatDateMedium } from "@/lib/format";
import { InstanceSection } from "./instance-page";

/**
 * Workspaces their owners scheduled for deletion: read-only until the date,
 * then purged. Hidden while there are none.
 */
export function PendingDeletionsSection() {
  const { t } = useTranslation();
  const query = useInstancePendingDeletions();
  const items = query.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <InstanceSection
      title={t("settings:workspaceDeletion.admin.title")}
      description={t("settings:workspaceDeletion.admin.description")}
      boxed={false}
    >
      <SettingsTable>
        <SettingsTableHeader>
          <SettingsTableRow>
            <SettingsTableHead>
              {t("instanceAdmin:workspaces.columns.name")}
            </SettingsTableHead>
            <SettingsTableHead>
              {t("instanceAdmin:workspaces.columns.owner")}
            </SettingsTableHead>
            <SettingsTableHead className="w-36">
              {t("settings:workspaceDeletion.admin.dueAt")}
            </SettingsTableHead>
          </SettingsTableRow>
        </SettingsTableHeader>
        <SettingsTableBody>
          {items.map((workspace) => (
            <SettingsTableRow key={workspace.id}>
              <SettingsTableCell kind="primary">
                <p className="font-medium text-sm">{workspace.name}</p>
                <TruncatedText
                  text={workspace.slug}
                  className="text-muted-foreground text-xs"
                />
              </SettingsTableCell>
              <SettingsTableCell
                label={t("instanceAdmin:workspaces.columns.owner")}
              >
                {workspace.owner ? (
                  <TruncatedText
                    text={workspace.owner.name || workspace.owner.email}
                    middle={!workspace.owner.name}
                    className="text-sm"
                  />
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {t("instanceAdmin:workspaces.noOwner")}
                  </span>
                )}
              </SettingsTableCell>
              <SettingsTableCell
                label={t("settings:workspaceDeletion.admin.dueAt")}
                className="whitespace-nowrap tabular-nums"
              >
                {workspace.deletionDueAt
                  ? formatDateMedium(workspace.deletionDueAt)
                  : null}
              </SettingsTableCell>
            </SettingsTableRow>
          ))}
        </SettingsTableBody>
      </SettingsTable>
    </InstanceSection>
  );
}
