import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceAiSettingsPage } from "@/components/ai/workspace-ai-settings";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/ai",
)({
  component: WorkspaceAiSettingsPage,
});
