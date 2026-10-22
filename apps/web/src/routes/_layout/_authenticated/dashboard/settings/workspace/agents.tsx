import { createFileRoute } from "@tanstack/react-router";
import { AgentsSettingsPage } from "@/components/ai/agents/agents-settings";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/agents",
)({
  component: AgentsSettingsPage,
});
