import { createFileRoute } from "@tanstack/react-router";
import { InstanceAiSettingsPage } from "@/components/ai/instance-ai-settings";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/instance/ai",
)({
  component: InstanceAiSettingsPage,
});
