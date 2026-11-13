import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { SlackAccountLinks } from "@/components/slack-app/slack-account-links";

// `link` is the token of a link prompt Slack showed the person (/margaya link).
const searchSchema = z.object({
  link: z.string().max(2048).optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/slack",
)({
  validateSearch: searchSchema,
  component: RouteComponent,
});

function RouteComponent() {
  const { link } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <SlackAccountLinks
      linkToken={link}
      onLinkHandled={() =>
        navigate({ search: { link: undefined }, replace: true })
      }
    />
  );
}
