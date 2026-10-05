import { createFileRoute } from "@tanstack/react-router";
import { WebhooksPage } from "@/components/webhook/webhooks-page";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/webhooks/",
)({
  component: WebhooksPage,
});
