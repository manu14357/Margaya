import { createFileRoute } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import { SettingsPage } from "@/components/settings-layout";
import InviteTeamMemberModal from "@/components/team/invite-team-member-modal";
import MembersTable from "@/components/team/members-table";
import { Button } from "@/components/ui/button";
import useGetFullWorkspace from "@/hooks/queries/workspace/use-get-full-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/members",
)({
  component: RouteComponent,
});

// Members belongs to the Settings destination (the panel lists it next to
// Account and Workspace), so it uses the settings page frame.
function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();
  const { data: workspace } = useGetFullWorkspace({ workspaceId });
  const { canInviteUsers } = useWorkspacePermission();
  const canInvite = Boolean(canInviteUsers());
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  return (
    <Layout>
      <Layout.TopBar title={t("navigation:page.settingsTitle")} />
      <Layout.ContentArea padded={false}>
        <SettingsPage
          width="wide"
          title={t("team:members.pageTitle")}
          description={t("team:members.subtitle")}
          actions={
            canInvite ? (
              <Button size="sm" onClick={() => setIsInviteOpen(true)}>
                <UserPlus />
                {t("team:members.inviteMember")}
              </Button>
            ) : undefined
          }
        >
          <div className="overflow-hidden rounded-lg border bg-card">
            <MembersTable
              workspaceId={workspaceId}
              users={workspace?.members ?? []}
              invitations={workspace?.invitations ?? []}
            />
          </div>

          <InviteTeamMemberModal
            open={isInviteOpen}
            onClose={() => setIsInviteOpen(false)}
          />
        </SettingsPage>
      </Layout.ContentArea>
    </Layout>
  );
}
