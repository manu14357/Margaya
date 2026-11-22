import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebhookDeliveriesTab } from "./webhook-deliveries-tab";

const m = vi.hoisted(() => ({ detailFor: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/i18n", () => ({
  i18n: {
    resolvedLanguage: "en-US",
    language: "en-US",
    t: (key: string) => key,
  },
}));

function summary(overrides: Record<string, unknown>) {
  return {
    id: "d-task",
    webhookId: "wh-1",
    event: "task.created",
    entityType: "task",
    entityId: "t-1",
    projectId: "p-1",
    summary: "WEB-1 Ship it",
    status: "succeeded",
    trigger: "event",
    redeliveryOf: null,
    attemptCount: 1,
    maxAttempts: 8,
    nextAttemptAt: null,
    responseStatus: 200,
    error: null,
    durationMs: 120,
    createdAt: "2026-11-20T10:00:00.000Z",
    completedAt: "2026-11-20T10:00:01.000Z",
    ...overrides,
  };
}

const ROWS = [
  summary({
    id: "d-ping",
    event: "webhook.ping",
    entityType: "webhook",
    entityId: "wh-1",
    projectId: null,
    summary: "webhook.ping",
    trigger: "ping",
    maxAttempts: 1,
  }),
  summary({}),
];

vi.mock("@/hooks/queries/webhook/use-webhook-deliveries", () => ({
  useWebhookDeliveries: () => ({
    data: { pages: [{ items: ROWS, nextCursor: null }] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
  }),
}));
vi.mock("@/hooks/queries/webhook/use-webhook-events", () => ({
  useWebhookEvents: () => ({ data: { families: [] } }),
}));
vi.mock("@/hooks/queries/webhook/use-webhook-delivery", () => ({
  useWebhookDelivery: (_webhookId: string, deliveryId: string | null) => {
    m.detailFor(deliveryId);
    const row = ROWS.find((item) => item.id === deliveryId);
    return {
      data: row
        ? {
            ...row,
            attempts: [],
            responseSnippet: null,
            requestHeaders: {},
            requestBody: {},
          }
        : undefined,
      isLoading: false,
      isError: false,
    };
  },
}));
vi.mock("@/hooks/mutations/webhook/use-redeliver-webhook-delivery", () => ({
  useRedeliverWebhookDelivery: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./webhook-family-labels", () => ({
  useFamilyText: () => () => ({ label: "", description: "" }),
}));

describe("WebhookDeliveriesTab", () => {
  afterEach(cleanup);

  it.each([
    [
      "a test ping",
      "d-ping",
      "settings:workspaceWebhooks.delivery.trigger.ping",
    ],
    [
      "a task event",
      "d-task",
      "settings:workspaceWebhooks.delivery.trigger.event",
    ],
  ])("opens the delivery sheet for %s", async (_name, id, trigger) => {
    render(
      <WebhookDeliveriesTab
        webhookId="wh-1"
        webhookIsActive
        onSendTest={vi.fn()}
        isSendingTest={false}
      />,
    );
    const event = id === "d-ping" ? "webhook.ping" : "task.created";
    const cell = screen.getAllByText(event).find((node) => node.closest("tr"));
    fireEvent.click(cell?.closest("tr") as HTMLElement);
    expect(m.detailFor).toHaveBeenLastCalledWith(id);
    expect(await screen.findByText(trigger)).toBeInTheDocument();
  });
});
