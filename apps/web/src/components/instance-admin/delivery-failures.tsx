import { useTranslation } from "react-i18next";
import {
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableHead,
  SettingsTableHeader,
  SettingsTableRow,
} from "@/components/settings/settings-table";
import { CompactDate } from "@/components/ui/compact-date";
import { DeliveryResponse } from "@/components/webhook/webhook-delivery-row";
import { useInstanceDeliveryFailures } from "@/hooks/queries/instance-admin/use-instance-admin";
import { InstanceLoadState, InstanceSection } from "./instance-page";

/** Webhook deliveries across the instance that used up their retries. */
export function DeliveryFailures() {
  const { t } = useTranslation();
  const failures = useInstanceDeliveryFailures();

  return (
    <InstanceSection
      title={t("instanceAdmin:general.deliveryFailures.title")}
      description={t("instanceAdmin:general.deliveryFailures.description")}
      boxed={false}
    >
      {!failures.data ? (
        <InstanceLoadState
          isLoading={failures.isLoading}
          isError={failures.isError}
          onRetry={() => void failures.refetch()}
        />
      ) : failures.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("instanceAdmin:general.deliveryFailures.empty")}
        </p>
      ) : (
        <SettingsTable>
          <SettingsTableHeader>
            <SettingsTableRow>
              <SettingsTableHead className="w-32">
                {t("instanceAdmin:general.deliveryFailures.when")}
              </SettingsTableHead>
              <SettingsTableHead className="w-40">
                {t("instanceAdmin:general.deliveryFailures.workspace")}
              </SettingsTableHead>
              <SettingsTableHead>
                {t("instanceAdmin:general.deliveryFailures.webhook")}
              </SettingsTableHead>
              <SettingsTableHead>
                {t("instanceAdmin:general.deliveryFailures.response")}
              </SettingsTableHead>
            </SettingsTableRow>
          </SettingsTableHeader>
          <SettingsTableBody>
            {failures.data.items.map((failure) => (
              <SettingsTableRow key={failure.id}>
                <SettingsTableCell
                  label={t("instanceAdmin:general.deliveryFailures.when")}
                  className="text-muted-foreground"
                >
                  <CompactDate value={failure.failedAt} />
                </SettingsTableCell>
                <SettingsTableCell
                  label={t("instanceAdmin:general.deliveryFailures.workspace")}
                  className="text-sm"
                >
                  {failure.workspaceName}
                </SettingsTableCell>
                <SettingsTableCell kind="primary" className="text-sm">
                  {failure.webhookName ? (
                    <>
                      <span>{failure.webhookName}</span>
                      <span className="text-muted-foreground">
                        {" · "}
                        {failure.event}
                      </span>
                    </>
                  ) : (
                    failure.event
                  )}
                </SettingsTableCell>
                <SettingsTableCell
                  label={t("instanceAdmin:general.deliveryFailures.response")}
                  className="text-sm"
                >
                  <DeliveryResponse
                    delivery={{
                      responseStatus: failure.responseStatus,
                      error: failure.error,
                      status: "failed",
                    }}
                  />
                </SettingsTableCell>
              </SettingsTableRow>
            ))}
          </SettingsTableBody>
        </SettingsTable>
      )}
    </InstanceSection>
  );
}
