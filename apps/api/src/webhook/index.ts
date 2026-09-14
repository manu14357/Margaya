import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { WEBHOOK_NOT_FOUND, type WebhookRow, webhookAccess } from "./access";
import { webhookEventCatalog } from "./catalog";
import { createWebhook } from "./controllers/create-webhook";
import { deleteWebhook } from "./controllers/delete-webhook";
import {
  getWebhookDelivery,
  listWebhookDeliveries,
  redeliverWebhookDelivery,
} from "./controllers/deliveries";
import { getWebhook } from "./controllers/get-webhook";
import { listWebhooks } from "./controllers/list-webhooks";
import { rotateWebhookSecret } from "./controllers/rotate-webhook-secret";
import { testWebhook } from "./controllers/test-webhook";
import { updateWebhook } from "./controllers/update-webhook";
import {
  webhookDeletedSchema,
  webhookDeliveryDetailSchema,
  webhookDeliveryPageSchema,
  webhookDeliverySummarySchema,
  webhookDetailSchema,
  webhookEventCatalogSchema,
  webhookSchema,
  webhookWithSecretSchema,
} from "./response";
import {
  createWebhookBody,
  listWebhookDeliveriesQuery,
  listWebhooksQuery,
  rotateWebhookSecretBody,
  updateWebhookBody,
  webhookDeliveryParam,
  webhookParam,
} from "./schema";
import "./subscribers";

// Workspace webhooks (B13a). Managing them and reading their delivery log
// needs workspace:manage_settings (admins and owners); the event catalog is
// readable by anyone signed in. Configuration changes publish no events.

const TAGS = ["Webhooks"];
const manageSettings = requireWorkspacePermission({
  workspace: ["manage_settings"],
});
const forbidden = errorResponse(
  "No workspace access, missing workspace:manage_settings, or an API key without that scope",
);
const notFound = errorResponse(WEBHOOK_NOT_FOUND);
const deliveryNotFound = errorResponse(
  "No webhook with this id, or no delivery of it with this id",
);

const listWebhookEventsRoute = createRoute({
  method: "get",
  operationId: "listWebhookEvents",
  path: "/events",
  tags: TAGS,
  summary: "List webhook events",
  description:
    'The public event catalog by family: what a webhook can subscribe to with "*", "<family>.*" or an event name. Events about private pages and private views, drafts, favorites, notifications and other personal data are never delivered. Any signed-in user or API key.',
  responses: {
    200: jsonResponse("The event catalog", webhookEventCatalogSchema),
    401: errorResponse("Not signed in"),
  },
});

const listWebhooksRoute = createRoute({
  method: "get",
  operationId: "listWebhooks",
  path: "/",
  tags: TAGS,
  summary: "List webhooks",
  description:
    "The workspace's webhooks, newest first (at most 20). Secrets are never returned. Needs workspace:manage_settings.",
  middleware: [workspaceAccess.fromQuery(), manageSettings] as const,
  request: { query: listWebhooksQuery },
  responses: {
    200: jsonResponse("The webhooks", webhookSchema.array()),
    403: forbidden,
  },
});

const createWebhookRoute = createRoute({
  method: "post",
  operationId: "createWebhook",
  path: "/",
  tags: TAGS,
  summary: "Create webhook",
  description:
    "Register an endpoint for workspace events. The URL must be http(s), carry no credentials, resolve to a public address and not point at this instance. The response carries the signing secret, shown once. Deliveries are signed with HMAC-SHA256 over the X-Margaya-Timestamp value, a period and the raw body, sent as X-Margaya-Signature-256: v1=<hex>. At most 20 webhooks per workspace and one per URL. Needs workspace:manage_settings.",
  middleware: [
    workspaceAccess.fromBody(),
    manageSettings,
    requireEntitlement,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createWebhookBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The webhook with its secret (shown once)",
      webhookWithSecretSchema,
    ),
    400: errorResponse(
      "Invalid body, an unknown event, or a URL that is malformed, carries credentials, is private or unreachable, or points at this instance",
    ),
    403: forbidden,
    409: errorResponse(
      "A webhook for this URL already exists, or the workspace has 20 webhooks",
    ),
  },
});

const getWebhookRoute = createRoute({
  method: "get",
  operationId: "getWebhook",
  path: "/{id}",
  tags: TAGS,
  summary: "Get webhook",
  description:
    "One webhook with its health and the number of pending deliveries. Needs workspace:manage_settings.",
  middleware: [webhookAccess(), manageSettings] as const,
  request: { params: webhookParam },
  responses: {
    200: jsonResponse("The webhook", webhookDetailSchema),
    403: forbidden,
    404: notFound,
  },
});

const updateWebhookRoute = createRoute({
  method: "patch",
  operationId: "updateWebhook",
  path: "/{id}",
  tags: TAGS,
  summary: "Update webhook",
  description:
    "Change the name, URL or events, or pause (isActive false: pending deliveries are cancelled) and enable it again (the failure streak resets; cancelled deliveries are not replayed). A new URL is validated like on create and applies to pending deliveries' next attempt. Needs workspace:manage_settings.",
  middleware: [webhookAccess(), manageSettings, requireEntitlement] as const,
  request: {
    params: webhookParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateWebhookBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated webhook", webhookSchema),
    400: errorResponse("Invalid body, an unknown event or a rejected URL"),
    403: forbidden,
    404: notFound,
    409: errorResponse("A webhook for this URL already exists"),
  },
});

const deleteWebhookRoute = createRoute({
  method: "delete",
  operationId: "deleteWebhook",
  path: "/{id}",
  tags: TAGS,
  summary: "Delete webhook",
  description:
    "Delete a webhook with its pending deliveries and delivery log. Needs workspace:manage_settings.",
  middleware: [webhookAccess(), manageSettings] as const,
  request: { params: webhookParam },
  responses: {
    200: jsonResponse("The webhook was deleted", webhookDeletedSchema),
    403: forbidden,
    404: notFound,
  },
});

const rotateWebhookSecretRoute = createRoute({
  method: "post",
  operationId: "rotateWebhookSecret",
  path: "/{id}/rotate-secret",
  tags: TAGS,
  summary: "Rotate webhook secret",
  description:
    "Create a new signing secret, shown once. The previous secret stays valid for graceHours (0–72, default 24), during which every delivery carries both signatures, the new one first. Also recovers a webhook whose secret became unreadable. Needs workspace:manage_settings.",
  middleware: [webhookAccess(), manageSettings, requireEntitlement] as const,
  request: {
    params: webhookParam,
    body: {
      required: false,
      content: { "application/json": { schema: rotateWebhookSecretBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The webhook with its new secret (shown once)",
      webhookWithSecretSchema,
    ),
    400: errorResponse("Invalid body"),
    403: forbidden,
    404: notFound,
  },
});

const testWebhookRoute = createRoute({
  method: "post",
  operationId: "testWebhook",
  path: "/{id}/test",
  tags: TAGS,
  summary: "Send test event",
  description:
    "Send webhook.ping once and wait for the answer (about 10 seconds at most). Works while the webhook is paused or disabled and never changes its health. Needs workspace:manage_settings.",
  middleware: [webhookAccess(), manageSettings, requireEntitlement] as const,
  request: { params: webhookParam },
  responses: {
    200: jsonResponse(
      "The test delivery after its single attempt",
      webhookDeliveryDetailSchema,
    ),
    403: forbidden,
    404: notFound,
  },
});

const listWebhookDeliveriesRoute = createRoute({
  method: "get",
  operationId: "listWebhookDeliveries",
  path: "/{id}/deliveries",
  tags: TAGS,
  summary: "List webhook deliveries",
  description:
    "One page of the delivery log, newest first, kept for WEBHOOK_DELIVERY_RETENTION_DAYS (default 14). Filter by status (comma-separated) and an exact event name; page with nextCursor. Needs workspace:manage_settings.",
  middleware: [webhookAccess(), manageSettings] as const,
  request: { params: webhookParam, query: listWebhookDeliveriesQuery },
  responses: {
    200: jsonResponse("A page of deliveries", webhookDeliveryPageSchema),
    400: errorResponse("Invalid query or cursor"),
    403: forbidden,
    404: notFound,
  },
});

const getWebhookDeliveryRoute = createRoute({
  method: "get",
  operationId: "getWebhookDelivery",
  path: "/{id}/deliveries/{deliveryId}",
  tags: TAGS,
  summary: "Get webhook delivery",
  description:
    "One delivery with its attempts, the last response's first 2 KB as plain text, the rebuilt request headers (signature masked) and the request body. Needs workspace:manage_settings.",
  middleware: [webhookAccess(), manageSettings] as const,
  request: { params: webhookDeliveryParam },
  responses: {
    200: jsonResponse("The delivery", webhookDeliveryDetailSchema),
    403: forbidden,
    404: deliveryNotFound,
  },
});

const redeliverWebhookDeliveryRoute = createRoute({
  method: "post",
  operationId: "redeliverWebhookDelivery",
  path: "/{id}/deliveries/{deliveryId}/redeliver",
  tags: TAGS,
  summary: "Redeliver webhook delivery",
  description:
    "Queue a new delivery with the same body, a new id and redelivery: true, linked to the original through redeliveryOf. Not for deliveries still in progress, tests, or while the webhook is not active. Needs workspace:manage_settings.",
  middleware: [webhookAccess(), manageSettings, requireEntitlement] as const,
  request: { params: webhookDeliveryParam },
  responses: {
    200: jsonResponse(
      "The new delivery, pending",
      webhookDeliverySummarySchema,
    ),
    403: forbidden,
    404: deliveryNotFound,
    409: errorResponse(
      "The delivery is still in progress, is a test, or the webhook is not active",
    ),
  },
});

const webhook = apiRouter<
  BaseVariables & { workspaceId: string; webhook: WebhookRow }
>()
  .openapi(listWebhookEventsRoute, (c) => c.json(webhookEventCatalog(), 200))
  .openapi(listWebhooksRoute, async (c) =>
    c.json(await listWebhooks(c.get("workspaceId")), 200),
  )
  .openapi(createWebhookRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await createWebhook({
        ...body,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
      }),
      200,
    );
  })
  .openapi(getWebhookRoute, async (c) =>
    c.json(await getWebhook(c.get("webhook")), 200),
  )
  .openapi(updateWebhookRoute, async (c) =>
    c.json(await updateWebhook(c.get("webhook"), c.req.valid("json")), 200),
  )
  .openapi(deleteWebhookRoute, async (c) =>
    c.json(await deleteWebhook(c.get("webhook")), 200),
  )
  .openapi(rotateWebhookSecretRoute, async (c) => {
    const body = c.req.valid("json") as { graceHours?: number } | undefined;
    return c.json(
      await rotateWebhookSecret(c.get("webhook"), body?.graceHours ?? 24),
      200,
    );
  })
  .openapi(testWebhookRoute, async (c) =>
    c.json(await testWebhook(c.get("webhook"), c.get("userId")), 200),
  )
  .openapi(listWebhookDeliveriesRoute, async (c) =>
    c.json(
      await listWebhookDeliveries(c.get("webhook"), c.req.valid("query")),
      200,
    ),
  )
  .openapi(getWebhookDeliveryRoute, async (c) =>
    c.json(
      await getWebhookDelivery(
        c.get("webhook"),
        c.req.valid("param").deliveryId,
      ),
      200,
    ),
  )
  .openapi(redeliverWebhookDeliveryRoute, async (c) =>
    c.json(
      await redeliverWebhookDelivery(
        c.get("webhook"),
        c.req.valid("param").deliveryId,
      ),
      200,
    ),
  );

export default webhook;
