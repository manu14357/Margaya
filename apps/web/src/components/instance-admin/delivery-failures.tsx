import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeliveryResponse } from "@/components/webhook/webhook-delivery-row";
import { useInstanceDeliveryFailures } from "@/hooks/queries/instance-admin/use-instance-admin";
import { formatDateTime } from "@/lib/format";
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
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("instanceAdmin:general.deliveryFailures.when")}
                </TableHead>
                <TableHead>
                  {t("instanceAdmin:general.deliveryFailures.workspace")}
                </TableHead>
                <TableHead>
                  {t("instanceAdmin:general.deliveryFailures.webhook")}
                </TableHead>
                <TableHead>
                  {t("instanceAdmin:general.deliveryFailures.response")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failures.data.items.map((failure) => (
                <TableRow key={failure.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    <time dateTime={String(failure.failedAt)}>
                      {formatDateTime(failure.failedAt)}
                    </time>
                  </TableCell>
                  <TableCell className="text-sm">
                    {failure.workspaceName}
                  </TableCell>
                  <TableCell className="text-sm">
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
                  </TableCell>
                  <TableCell className="text-sm">
                    <DeliveryResponse
                      delivery={{
                        responseStatus: failure.responseStatus,
                        error: failure.error,
                        status: "failed",
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </InstanceSection>
  );
}
