import { createFileRoute } from "@tanstack/react-router";
import { AiMemorySettingsPage } from "@/components/ai/ai-memory-settings";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/ai-memory",
)({
  component: AiMemorySettingsPage,
});
