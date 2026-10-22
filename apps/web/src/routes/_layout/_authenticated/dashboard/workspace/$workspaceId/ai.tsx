import { createFileRoute } from "@tanstack/react-router";
import { AskFullPage } from "@/components/ai/ask/ask-full-page";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/ai",
)({
  component: AskFullPage,
});
