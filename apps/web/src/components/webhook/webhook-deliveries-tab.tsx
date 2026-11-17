import { Send } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsTable,
  SettingsTableBody,
  SettingsTableHead,
  SettingsTableHeader,
  SettingsTableRow,
} from "@/components/settings/settings-table";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Frame, FramePanel } from "@/components/ui/frame";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useWebhookDeliveries } from "@/hooks/queries/webhook/use-webhook-deliveries";
import { useWebhookEvents } from "@/hooks/queries/webhook/use-webhook-events";
import type {
  DeliveryStatusFilter,
  WebhookDeliveryFilters,
} from "@/types/webhook";
import { WebhookDeliveryRow } from "./webhook-delivery-row";
import { WebhookDeliverySheet } from "./webhook-delivery-sheet";
import { useFamilyText } from "./webhook-family-labels";

const STATUS_FILTERS = [
  "all",
  "succeeded",
  "failed",
  "inProgress",
  "cancelled",
] as const satisfies readonly DeliveryStatusFilter[];

const STATUS_FILTER_KEYS = {
  all: "settings:workspaceWebhooks.deliveries.allStatuses",
  succeeded: "settings:workspaceWebhooks.deliveries.status.succeeded",
  failed: "settings:workspaceWebhooks.deliveries.status.failed",
  inProgress: "settings:workspaceWebhooks.deliveries.status.inProgress",
  cancelled: "settings:workspaceWebhooks.deliveries.status.cancelled",
} as const satisfies Record<DeliveryStatusFilter, string>;

const ALL_EVENTS_VALUE = "__all__";

type WebhookDeliveriesTabProps = {
  webhookId: string;
  webhookIsActive: boolean;
  onSendTest: () => void;
  isSendingTest: boolean;
};

/** The delivery log: filters, a paged table and the delivery sheet. */
export function WebhookDeliveriesTab({
  webhookId,
  webhookIsActive,
  onSendTest,
  isSendingTest,
}: WebhookDeliveriesTabProps) {
  const { t } = useTranslation();
  const familyText = useFamilyText();
  const [filters, setFilters] = useState<WebhookDeliveryFilters>({
    status: "all",
    event: null,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const deliveries = useWebhookDeliveries(webhookId, filters);
  const catalog = useWebhookEvents();
  const rows = useMemo(
    () => deliveries.data?.pages.flatMap((page) => page.items) ?? [],
    [deliveries.data],
  );
  const filtered = filters.status !== "all" || filters.event !== null;

  const sendTestButton = (
    <Button variant="outline" onClick={onSendTest} disabled={isSendingTest}>
      {isSendingTest ? <Spinner className="size-4" /> : <Send />}
      {isSendingTest
        ? t("settings:workspaceWebhooks.test.sending")
        : t("settings:workspaceWebhooks.test.button")}
    </Button>
  );

  let body: React.ReactNode;
  if (deliveries.isLoading) {
    body = (
      <Frame>
        <FramePanel className="space-y-3 p-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-6 w-full" />
          ))}
        </FramePanel>
      </Frame>
    );
  } else if (deliveries.isError) {
    body = (
      <Frame>
        <FramePanel className="flex items-center justify-between gap-3 p-4 text-sm">
          <span className="text-destructive-foreground">
            {t("settings:workspaceWebhooks.deliveries.loadError")}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void deliveries.refetch()}
          >
            {t("settings:workspaceWebhooks.retry")}
          </Button>
        </FramePanel>
      </Frame>
    );
  } else if (rows.length === 0) {
    body = filtered ? (
      <Frame>
        <FramePanel className="p-8 text-center text-muted-foreground text-sm">
          {t("settings:workspaceWebhooks.deliveries.noMatch")}
        </FramePanel>
      </Frame>
    ) : (
      <Empty className="rounded-xl border py-10">
        <EmptyHeader>
          <EmptyTitle>
            {t("settings:workspaceWebhooks.deliveries.emptyTitle")}
          </EmptyTitle>
          <EmptyDescription>
            {t("settings:workspaceWebhooks.deliveries.emptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>{sendTestButton}</EmptyContent>
      </Empty>
    );
  } else {
    body = (
      <div className="space-y-3">
        <SettingsTable>
          <SettingsTableHeader>
            <SettingsTableRow>
              <SettingsTableHead className="w-32">
                {t("settings:workspaceWebhooks.deliveries.columns.status")}
              </SettingsTableHead>
              <SettingsTableHead>
                {t("settings:workspaceWebhooks.deliveries.columns.event")}
              </SettingsTableHead>
              <SettingsTableHead hideBelow="lg">
                {t("settings:workspaceWebhooks.deliveries.columns.summary")}
              </SettingsTableHead>
              <SettingsTableHead className="w-36">
                {t("settings:workspaceWebhooks.deliveries.columns.response")}
              </SettingsTableHead>
              <SettingsTableHead className="w-24" hideBelow="md">
                {t("settings:workspaceWebhooks.deliveries.columns.attempts")}
              </SettingsTableHead>
              <SettingsTableHead className="w-28">
                {t("settings:workspaceWebhooks.deliveries.columns.created")}
              </SettingsTableHead>
              <SettingsTableHead className="w-24" align="end" hideBelow="md">
                {t("settings:workspaceWebhooks.deliveries.columns.duration")}
              </SettingsTableHead>
            </SettingsTableRow>
          </SettingsTableHeader>
          <SettingsTableBody>
            {rows.map((delivery) => (
              <WebhookDeliveryRow
                key={delivery.id}
                delivery={delivery}
                onOpen={() => setOpenId(delivery.id)}
              />
            ))}
          </SettingsTableBody>
        </SettingsTable>
        {deliveries.hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void deliveries.fetchNextPage()}
              disabled={deliveries.isFetchingNextPage}
            >
              {deliveries.isFetchingNextPage && <Spinner className="size-4" />}
              {t("settings:workspaceWebhooks.deliveries.loadMore")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.status}
          onValueChange={(value) => {
            const status = STATUS_FILTERS.find((option) => option === value);
            if (status) setFilters((current) => ({ ...current, status }));
          }}
        >
          <SelectTrigger
            className="w-44"
            aria-label={t("settings:workspaceWebhooks.deliveries.filterStatus")}
          >
            <SelectValue>{t(STATUS_FILTER_KEYS[filters.status])}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((status) => (
              <SelectItem key={status} value={status}>
                {t(STATUS_FILTER_KEYS[status])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.event ?? ALL_EVENTS_VALUE}
          onValueChange={(value) =>
            setFilters((current) => ({
              ...current,
              event:
                !value || value === ALL_EVENTS_VALUE ? null : String(value),
            }))
          }
        >
          <SelectTrigger
            className="w-60"
            aria-label={t("settings:workspaceWebhooks.deliveries.filterEvent")}
          >
            <SelectValue>
              {filters.event ? (
                <code className="font-mono text-xs">{filters.event}</code>
              ) : (
                t("settings:workspaceWebhooks.deliveries.allEvents")
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value={ALL_EVENTS_VALUE}>
              {t("settings:workspaceWebhooks.deliveries.allEvents")}
            </SelectItem>
            {catalog.data?.families.map((family) => (
              <SelectGroup key={family.key}>
                <SelectGroupLabel>
                  {familyText(family.key).label}
                </SelectGroupLabel>
                {family.events.map((event) => (
                  <SelectItem key={event.name} value={event.name}>
                    <code className="font-mono text-xs">{event.name}</code>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
            <SelectGroup>
              <SelectGroupLabel>
                {t("settings:workspaceWebhooks.delivery.trigger.ping")}
              </SelectGroupLabel>
              <SelectItem value="webhook.ping">
                <code className="font-mono text-xs">webhook.ping</code>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {body}

      <WebhookDeliverySheet
        webhookId={webhookId}
        deliveryId={openId}
        webhookIsActive={webhookIsActive}
        onClose={() => setOpenId(null)}
        onOpenDelivery={setOpenId}
      />
    </div>
  );
}

export default WebhookDeliveriesTab;
