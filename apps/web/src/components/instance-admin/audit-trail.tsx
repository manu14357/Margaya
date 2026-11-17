import { useTranslation } from "react-i18next";
import {
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableHead,
  SettingsTableHeader,
  SettingsTableRow,
} from "@/components/settings/settings-table";
import { Button } from "@/components/ui/button";
import { CompactDate } from "@/components/ui/compact-date";
import { TruncatedText } from "@/components/ui/truncated-text";
import { useInstanceAuditLog } from "@/hooks/queries/instance-admin/use-instance-admin";
import { INSTANCE_AUDIT_ACTION_KEYS } from "@/lib/instance-audit";
import { InstanceLoadState, InstanceSection } from "./instance-page";

/** The instance audit trail: who changed what on the instance, and when. */
export function AuditTrail() {
  const { t } = useTranslation();
  const audit = useInstanceAuditLog();
  const entries = audit.data?.pages.flatMap((page) => page.items) ?? [];

  const actionLabel = (action: string) => {
    const key =
      INSTANCE_AUDIT_ACTION_KEYS[
        action as keyof typeof INSTANCE_AUDIT_ACTION_KEYS
      ];
    return key ? t(key) : action;
  };

  return (
    <InstanceSection
      title={t("accountSecurity:auditTrail.title")}
      description={t("accountSecurity:auditTrail.subtitle")}
      boxed={false}
    >
      {!audit.data ? (
        <InstanceLoadState
          isLoading={audit.isLoading}
          isError={audit.isError}
          onRetry={() => void audit.refetch()}
        />
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("accountSecurity:auditTrail.empty")}
        </p>
      ) : (
        <div className="space-y-3">
          <SettingsTable>
            <SettingsTableHeader>
              <SettingsTableRow>
                <SettingsTableHead className="w-36">
                  {t("accountSecurity:auditTrail.when")}
                </SettingsTableHead>
                <SettingsTableHead className="w-44">
                  {t("accountSecurity:auditTrail.who")}
                </SettingsTableHead>
                <SettingsTableHead>
                  {t("accountSecurity:auditTrail.what")}
                </SettingsTableHead>
              </SettingsTableRow>
            </SettingsTableHeader>
            <SettingsTableBody>
              {entries.map((entry) => (
                <SettingsTableRow key={entry.id}>
                  <SettingsTableCell
                    label={t("accountSecurity:auditTrail.when")}
                    className="text-muted-foreground"
                  >
                    <CompactDate value={entry.createdAt} />
                  </SettingsTableCell>
                  <SettingsTableCell
                    label={t("accountSecurity:auditTrail.who")}
                  >
                    <TruncatedText
                      text={
                        entry.actorName ??
                        (entry.actorType === "system"
                          ? t("accountSecurity:auditTrail.system")
                          : "—")
                      }
                    />
                  </SettingsTableCell>
                  {/* Long setting lists wrap instead of widening the table. */}
                  <SettingsTableCell kind="primary" className="leading-5">
                    <span>{actionLabel(entry.action)}</span>
                    {entry.targetLabel ? (
                      <span className="text-muted-foreground">
                        {" · "}
                        {entry.targetLabel}
                      </span>
                    ) : null}
                  </SettingsTableCell>
                </SettingsTableRow>
              ))}
            </SettingsTableBody>
          </SettingsTable>
          {audit.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              loading={audit.isFetchingNextPage}
              onClick={() => void audit.fetchNextPage()}
            >
              {t("accountSecurity:auditTrail.loadMore")}
            </Button>
          ) : null}
        </div>
      )}
    </InstanceSection>
  );
}
