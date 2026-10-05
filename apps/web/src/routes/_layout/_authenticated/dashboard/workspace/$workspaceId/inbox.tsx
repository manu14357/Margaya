import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import InboxPage from "@/components/inbox/inbox-page";
import PageTitle from "@/components/page-title";
import { type InboxSearch, validateInboxSearch } from "@/lib/inbox-search";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/inbox",
)({
  validateSearch: (search: Record<string, unknown>): InboxSearch =>
    validateInboxSearch(search),
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  // Filters and the selection replace the history entry, so Back leaves
  // the inbox instead of stepping through every click.
  const handleSearchChange = useCallback(
    (patch: Partial<InboxSearch>) =>
      navigate({
        search: (previous: InboxSearch) => ({ ...previous, ...patch }),
        replace: true,
      }),
    [navigate],
  );

  return (
    <>
      <PageTitle title={t("notifications:inbox.pageTitle")} />
      <Layout>
        <Layout.TopBar title={t("notifications:inbox.pageTitle")} />
        <InboxPage
          workspaceId={workspaceId}
          search={search}
          onSearchChange={handleSearchChange}
        />
      </Layout>
    </>
  );
}
