import { createFileRoute } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsFrame } from "@/components/settings/settings-frame";
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

// Members is a workspace setting: it keeps this URL (links and bookmarks use
// it) and renders in the settings frame, with the workspace's settings pages.
function RouteComponent() {
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();
  const { data: workspace } = useGetFullWorkspace({ workspaceId });
  const { canInviteUsers } = useWorkspacePermission();
  const canInvite = Boolean(canInviteUsers());
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  return (
    <SettingsFrame>
      <SettingsPage
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
        <div className="overflow-x-auto rounded-lg border bg-card">
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
    </SettingsFrame>
  );
}
