import { createFileRoute } from "@tanstack/react-router";
import { AiSkillsSettingsPage } from "@/components/ai/ai-skills-settings";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/ai-skills",
)({
  component: AiSkillsSettingsPage,
});
