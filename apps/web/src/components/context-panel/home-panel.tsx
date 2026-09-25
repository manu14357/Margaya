import { useLocation, useNavigate } from "@tanstack/react-router";
import { House, Mail, StickyNote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNeedsEmailVerification } from "@/components/account/email-verification-prompt";
import {
  PanelCount,
  PanelHint,
  PanelLink,
  PanelSection,
} from "@/components/context-panel/panel-primitives";
import { usePendingInvitations } from "@/hooks/queries/invitation/use-pending-invitations";
import useGetRecentVisits from "@/hooks/queries/recent-visit/use-get-recent-visits";
import { getEntityIcon, getEntityPath } from "@/lib/entity-links";

/** Home: the overview pages, then what you opened recently. */
export function HomePanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { data: invitations = [] } = usePendingInvitations();
  const { data: recents, isSuccess } = useGetRecentVisits({
    workspaceId,
    limit: 8,
  });
  const base = `/dashboard/workspace/${workspaceId}`;
  const invitationsActive = pathname === "/dashboard/invitations";
  // Unverified addresses see no invitations; the page explains how to verify.
  const needsVerification = useNeedsEmailVerification();

  return (
    <>
      <PanelSection>
        <PanelLink
          label={t("navigation:sidebar.home")}
          icon={House}
          active={pathname.replace(/\/+$/, "") === base}
          onSelect={() => navigate({ to: base })}
        />
        <PanelLink
          label={t("navigation:sidebar.stickies")}
          icon={StickyNote}
          active={pathname.startsWith(`${base}/stickies`)}
          onSelect={() => navigate({ to: `${base}/stickies` })}
        />
        {(invitations.length > 0 || invitationsActive || needsVerification) && (
          <PanelLink
            label={t("navigation:sidebar.invitations")}
            icon={Mail}
            active={invitationsActive}
            trailing={
              invitations.length > 0 ? (
                <PanelCount count={invitations.length} />
              ) : undefined
            }
            onSelect={() => navigate({ to: "/dashboard/invitations" })}
          />
        )}
      </PanelSection>

      <PanelSection label={t("navigation:shell.recent")}>
        {isSuccess && recents.length === 0 && (
          <PanelHint>{t("navigation:shell.noRecent")}</PanelHint>
        )}
        {(recents ?? []).map((visit) => {
          const path = getEntityPath(visit.entity, workspaceId);
          if (!path) return null;
          const Icon = getEntityIcon(visit.entity);
          return (
            <PanelLink
              key={`${visit.entity.type}:${visit.entity.id}`}
              label={visit.entity.name}
              icon={Icon}
              active={pathname === path}
              onSelect={() => navigate({ to: path })}
            />
          );
        })}
      </PanelSection>
    </>
  );
}
