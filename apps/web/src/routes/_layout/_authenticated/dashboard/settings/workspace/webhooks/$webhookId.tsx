import { createFileRoute } from "@tanstack/react-router";
import {
  WebhookDetailPage,
  type WebhookDetailTab,
} from "@/components/webhook/webhook-detail-page";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/webhooks/$webhookId",
)({
  // The tab lives in the URL so links can target the delivery log.
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: WebhookDetailTab } =>
    search.tab === "settings" || search.tab === "deliveries"
      ? { tab: search.tab }
      : {},
  component: RouteComponent,
});

function RouteComponent() {
  const { webhookId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <WebhookDetailPage
      webhookId={webhookId}
      tab={tab ?? "deliveries"}
      onTabChange={(next) =>
        void navigate({ search: { tab: next }, replace: true })
      }
    />
  );
}
