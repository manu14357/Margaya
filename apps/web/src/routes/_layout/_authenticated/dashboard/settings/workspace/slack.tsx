import { createFileRoute } from "@tanstack/react-router";
import { SlackAppSettings } from "@/components/slack-app/slack-app-settings";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/slack",
)({
  component: SlackAppSettings,
});
