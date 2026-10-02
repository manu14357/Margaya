import { useNavigate } from "@tanstack/react-router";
import {
  CircleCheck,
  CircleUserRound,
  FolderKanban,
  type LucideIcon,
  Settings,
  UserPlus,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import CreateProjectModal from "@/components/shared/modals/create-project-modal";
import InviteTeamMemberModal from "@/components/team/invite-team-member-modal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetFullWorkspace from "@/hooks/queries/workspace/use-get-full-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import {
  type GetStartedState,
  readGetStartedState,
  writeGetStartedState,
} from "@/lib/get-started-storage";

type Item = {
  key: string;
  titleKey: string;
  descriptionKey: string;
  actionKey: string;
  icon: LucideIcon;
  done: boolean;
  visible: boolean;
  onAction: () => void;
};

function GetStartedItem({ item }: { item: Item }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <Card className="flex-row items-start gap-3 p-4">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          item.done
            ? "bg-muted text-muted-foreground"
            : "bg-primary/10 text-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">{t(item.titleKey)}</p>
        <p className="text-xs text-muted-foreground">
          {t(item.descriptionKey)}
        </p>
        {item.done ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <CircleCheck className="size-3.5 text-success-foreground" />
            {t("home:getStarted.done")}
          </p>
        ) : (
          <Button
            variant="link"
            size="xs"
            className="h-auto px-0 sm:h-auto"
            onClick={item.onAction}
          >
            {t(item.actionKey)}
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * First steps for a new workspace. Hidden once dismissed in this browser,
 * or once the workspace has a project and a second member.
 */
export default function GetStarted({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: projects, isSuccess: projectsLoaded } = useGetProjects({
    workspaceId,
  });
  const { data: workspace, isSuccess: membersLoaded } = useGetFullWorkspace({
    workspaceId,
  });
  const { canCreateProjects, canInviteUsers, canManageWorkspace } =
    useWorkspacePermission();
  const [state, setState] = useState<GetStartedState>(() =>
    readGetStartedState(workspaceId),
  );
  const [dialog, setDialog] = useState<"project" | "invite" | null>(null);

  const update = (change: Partial<GetStartedState>) => {
    setState(writeGetStartedState(workspaceId, change));
  };

  if (!projectsLoaded || !membersLoaded || state.hidden) return null;

  const hasProject = (projects?.length ?? 0) > 0;
  const hasTeam = (workspace?.members?.length ?? 0) >= 2;
  if (hasProject && hasTeam) return null;

  const items: Item[] = [
    {
      key: "createProject",
      titleKey: "home:getStarted.createProject.title",
      descriptionKey: "home:getStarted.createProject.description",
      actionKey: "home:getStarted.createProject.action",
      icon: FolderKanban,
      done: hasProject,
      visible: hasProject || Boolean(canCreateProjects()),
      onAction: () => setDialog("project"),
    },
    {
      key: "inviteTeam",
      titleKey: "home:getStarted.inviteTeam.title",
      descriptionKey: "home:getStarted.inviteTeam.description",
      actionKey: "home:getStarted.inviteTeam.action",
      icon: UserPlus,
      done: hasTeam,
      visible: hasTeam || Boolean(canInviteUsers()),
      onAction: () => setDialog("invite"),
    },
    {
      key: "configureWorkspace",
      titleKey: "home:getStarted.configureWorkspace.title",
      descriptionKey: "home:getStarted.configureWorkspace.description",
      actionKey: "home:getStarted.configureWorkspace.action",
      icon: Settings,
      done: state.visitedWorkspaceSettings,
      visible: Boolean(canManageWorkspace()),
      onAction: () => {
        update({ visitedWorkspaceSettings: true });
        navigate({ to: "/dashboard/settings/workspace/general" });
      },
    },
    {
      key: "personalize",
      titleKey: "home:getStarted.personalize.title",
      descriptionKey: "home:getStarted.personalize.description",
      actionKey: "home:getStarted.personalize.action",
      icon: CircleUserRound,
      done: state.visitedAccount,
      visible: true,
      onAction: () => {
        update({ visitedAccount: true });
        navigate({ to: "/dashboard/settings/account/information" });
      },
    },
  ];
  const visibleItems = items.filter((item) => item.visible);
  if (visibleItems.length === 0) return null;

  return (
    <section aria-labelledby="home-get-started" className="space-y-3">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h2
          id="home-get-started"
          className="text-sm font-medium text-muted-foreground"
        >
          {t("home:getStarted.title")}
        </h2>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => update({ hidden: true })}
        >
          <X />
          {t("home:getStarted.dismiss")}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {visibleItems.map((item) => (
          <GetStartedItem key={item.key} item={item} />
        ))}
      </div>

      <CreateProjectModal
        open={dialog === "project"}
        onClose={() => setDialog(null)}
      />
      <InviteTeamMemberModal
        open={dialog === "invite"}
        onClose={() => setDialog(null)}
      />
    </section>
  );
}
