import { Copy, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRedeliverWebhookDelivery } from "@/hooks/mutations/webhook/use-redeliver-webhook-delivery";
import { useWebhookDelivery } from "@/hooks/queries/webhook/use-webhook-delivery";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import {
  formatRequestBody,
  type RedeliverBlock,
  redeliverBlock,
} from "@/lib/webhook/delivery";
import type {
  WebhookDeliveryDetail,
  WebhookDeliverySummary,
} from "@/types/webhook";
import { DeliveryStatusBadge } from "./delivery-status-badge";
import { DeliveryResponse } from "./webhook-delivery-row";

const TRIGGER_KEYS = {
  event: "settings:workspaceWebhooks.delivery.trigger.event",
  redelivery: "settings:workspaceWebhooks.delivery.trigger.redelivery",
  ping: "settings:workspaceWebhooks.delivery.trigger.ping",
} as const satisfies Record<WebhookDeliverySummary["trigger"], string>;

const BLOCK_KEYS = {
  inactive: "settings:workspaceWebhooks.delivery.redeliverInactive",
  inProgress: "settings:workspaceWebhooks.delivery.redeliverInProgress",
  ping: "settings:workspaceWebhooks.delivery.redeliverPing",
} as const satisfies Record<RedeliverBlock, string>;

type WebhookDeliverySheetProps = {
  webhookId: string;
  deliveryId: string | null;
  webhookIsActive: boolean;
  onClose: () => void;
  /** Opens another delivery (the original of a redelivery). */
  onOpenDelivery: (deliveryId: string) => void;
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="font-medium text-sm">{title}</h3>
      {children}
    </section>
  );
}

// Bodies and response snippets are external text: always text nodes in a
// <pre>, never parsed as HTML or markdown.
function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/50 p-3 font-mono text-xs">
      {children}
    </pre>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function DeliveryBody({
  delivery,
  onOpenDelivery,
}: {
  delivery: WebhookDeliveryDetail;
  onOpenDelivery: (deliveryId: string) => void;
}) {
  const { t } = useTranslation();

  const copyId = async () => {
    if (await copyToClipboard(delivery.id)) {
      toast.success(t("settings:workspaceWebhooks.delivery.idCopied"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Field label={t("settings:workspaceWebhooks.delivery.event")}>
          <code className="font-mono text-xs">{delivery.event}</code>
        </Field>
        <Field label={t("settings:workspaceWebhooks.delivery.status")}>
          <DeliveryStatusBadge status={delivery.status} />
        </Field>
        <Field label={t("settings:workspaceWebhooks.delivery.id")}>
          <span className="inline-flex min-w-0 items-center gap-1">
            <code className="truncate font-mono text-xs">{delivery.id}</code>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={copyId}
              aria-label={t("settings:workspaceWebhooks.delivery.copyId")}
            >
              <Copy className="size-3.5" />
            </Button>
          </span>
        </Field>
        <Field label={t("settings:workspaceWebhooks.delivery.trigger.label")}>
          {t(TRIGGER_KEYS[delivery.trigger])}
        </Field>
        {delivery.redeliveryOf && (
          <Field label="">
            <button
              type="button"
              className="text-primary text-xs hover:underline"
              onClick={() => onOpenDelivery(delivery.redeliveryOf as string)}
            >
              {t("settings:workspaceWebhooks.delivery.redeliveryOf", {
                id: delivery.redeliveryOf,
              })}
            </button>
          </Field>
        )}
      </div>

      <Section title={t("settings:workspaceWebhooks.delivery.attempts")}>
        {delivery.attempts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("settings:workspaceWebhooks.delivery.noAttempts")}
          </p>
        ) : (
          <ol className="space-y-2 border-s ps-4">
            {delivery.attempts.map((attempt, index) => (
              <li
                // Attempts are append-only, so the position is stable.
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
                key={index}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
              >
                <time
                  dateTime={attempt.at}
                  className="text-muted-foreground text-xs"
                >
                  {formatDateTime(attempt.at)}
                </time>
                <DeliveryResponse
                  delivery={{
                    responseStatus: attempt.responseStatus,
                    error: attempt.error,
                    status: "failed",
                  }}
                />
                {attempt.durationMs !== null && (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {t("settings:workspaceWebhooks.deliveries.durationValue", {
                      ms: attempt.durationMs,
                    })}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
        {delivery.status === "pending" && delivery.nextAttemptAt && (
          <p className="text-muted-foreground text-xs">
            {t("settings:workspaceWebhooks.delivery.nextAttempt", {
              time: formatRelativeTime(delivery.nextAttemptAt),
            })}
          </p>
        )}
      </Section>

      <Section title={t("settings:workspaceWebhooks.delivery.requestHeaders")}>
        <CodeBlock>
          {Object.entries(delivery.requestHeaders)
            .map(([name, value]) => `${name}: ${value}`)
            .join("\n")}
        </CodeBlock>
      </Section>

      <Section title={t("settings:workspaceWebhooks.delivery.requestBody")}>
        <CodeBlock>{formatRequestBody(delivery.requestBody)}</CodeBlock>
      </Section>

      <Section title={t("settings:workspaceWebhooks.delivery.response")}>
        {delivery.responseStatus === null && !delivery.responseSnippet ? (
          <p className="text-muted-foreground text-sm">
            {t("settings:workspaceWebhooks.delivery.noResponse")}
          </p>
        ) : (
          <div className="space-y-2">
            <DeliveryResponse delivery={delivery} />
            {delivery.responseSnippet && (
              <CodeBlock>{delivery.responseSnippet}</CodeBlock>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

/** The right-side sheet of one delivery: attempts, request, response. */
export function WebhookDeliverySheet({
  webhookId,
  deliveryId,
  webhookIsActive,
  onClose,
  onOpenDelivery,
}: WebhookDeliverySheetProps) {
  const { t } = useTranslation();
  const query = useWebhookDelivery(webhookId, deliveryId);
  const redeliver = useRedeliverWebhookDelivery();
  const delivery = query.data;
  const block = delivery ? redeliverBlock(delivery, webhookIsActive) : null;

  const handleRedeliver = () => {
    if (!delivery) return;
    redeliver.mutate(
      { webhookId, deliveryId: delivery.id },
      {
        onSuccess: (created) => {
          toast.success(t("settings:workspaceWebhooks.delivery.redelivered"));
          onOpenDelivery(created.id);
        },
        onError: (error) =>
          toast.error(
            error.message || t("settings:workspaceWebhooks.toast.error"),
          ),
      },
    );
  };

  const redeliverButton = (
    <Button
      onClick={handleRedeliver}
      disabled={!delivery || block !== null || redeliver.isPending}
      loading={redeliver.isPending}
    >
      <RotateCw />
      {t("settings:workspaceWebhooks.delivery.redeliver")}
    </Button>
  );

  return (
    <Sheet
      open={Boolean(deliveryId)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {t("settings:workspaceWebhooks.delivery.title")}
          </SheetTitle>
          <SheetDescription>
            {t("settings:workspaceWebhooks.delivery.description")}
          </SheetDescription>
        </SheetHeader>
        <SheetPanel>
          {query.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : query.isError || !delivery ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-destructive-foreground">
                {t("settings:workspaceWebhooks.delivery.loadError")}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
              >
                {t("settings:workspaceWebhooks.retry")}
              </Button>
            </div>
          ) : (
            <DeliveryBody delivery={delivery} onOpenDelivery={onOpenDelivery} />
          )}
        </SheetPanel>
        {delivery && (
          <SheetFooter>
            {block ? (
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex" />}>
                  {redeliverButton}
                </TooltipTrigger>
                <TooltipContent>{t(BLOCK_KEYS[block])}</TooltipContent>
              </Tooltip>
            ) : (
              redeliverButton
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default WebhookDeliverySheet;
