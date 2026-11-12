import { Bell, BellOff, Megaphone, Plus } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { TopBarLabel } from "@/components/common/header/top-bar-label";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import ProjectFeatureGate from "@/components/project/project-feature-gate";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useSetProjectUpdateFollow,
  useSetProjectUpdateReminder,
} from "@/hooks/mutations/project-update/use-project-update-mutations";
import useGetProject from "@/hooks/queries/project/use-get-project";
import {
  useProjectUpdateFollow,
  useProjectUpdateReminder,
  useProjectUpdates,
} from "@/hooks/queries/project-update/use-project-updates";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import UpdateCard from "./update-card";
import UpdateComposer from "./update-composer";

// The same weekday names the email digest settings use.
const WEEKDAY_KEYS = [
  "settings:notificationsPage.digestWeekdaySunday",
  "settings:notificationsPage.digestWeekdayMonday",
  "settings:notificationsPage.digestWeekdayTuesday",
  "settings:notificationsPage.digestWeekdayWednesday",
  "settings:notificationsPage.digestWeekdayThursday",
  "settings:notificationsPage.digestWeekdayFriday",
  "settings:notificationsPage.digestWeekdaySaturday",
] as const;

type ScreenProps = { workspaceId: string; projectId: string };

function FollowButton({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const follow = useProjectUpdateFollow(projectId);
  const setFollow = useSetProjectUpdateFollow(projectId);
  if (!follow.data) return null;
  const following = follow.data.following;
  return (
    <Button
      variant="outline"
      size="xs"
      className="gap-1"
      aria-pressed={following}
      loading={setFollow.isPending}
      onClick={() =>
        setFollow.mutate(!following, {
          onError: () => toast.error(t("projectUpdates:follow.error")),
        })
      }
    >
      {following ? (
        <BellOff aria-hidden className="size-3.5" />
      ) : (
        <Bell aria-hidden className="size-3.5" />
      )}
      {t(
        following
          ? "projectUpdates:follow.unfollow"
          : "projectUpdates:follow.follow",
      )}
    </Button>
  );
}

function ReminderControl({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const id = useId();
  const reminder = useProjectUpdateReminder(projectId);
  const save = useSetProjectUpdateReminder(projectId);
  if (!reminder.data) return null;
  const { enabled, weekday, leadUserId } = reminder.data;
  const update = (next: { enabled: boolean; weekday?: number }) =>
    save.mutate(next, {
      onError: () => toast.error(t("projectUpdates:reminder.error")),
    });
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Switch
        id={`${id}-reminder`}
        checked={enabled}
        disabled={save.isPending}
        onCheckedChange={(checked) => update({ enabled: checked, weekday })}
      />
      <label htmlFor={`${id}-reminder`}>
        {t("projectUpdates:reminder.label")}
      </label>
      {enabled && (
        <Select
          disabled={save.isPending}
          value={String(weekday)}
          onValueChange={(value) =>
            update({ enabled: true, weekday: Number(value) })
          }
        >
          <SelectTrigger
            className="w-36"
            aria-label={t("projectUpdates:reminder.weekday")}
          >
            <SelectValue>
              {t(WEEKDAY_KEYS[weekday] ?? WEEKDAY_KEYS[5])}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {WEEKDAY_KEYS.map((key, day) => (
              <SelectItem key={key} value={String(day)}>
                {t(key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {enabled && !leadUserId && (
        <span className="text-muted-foreground text-xs">
          {t("projectUpdates:reminder.noLead")}
        </span>
      )}
    </div>
  );
}

function Timeline({
  workspaceId,
  projectId,
  canPost,
  onCompose,
}: ScreenProps & { canPost: boolean; onCompose: () => void }) {
  const { t } = useTranslation();
  const updates = useProjectUpdates(projectId);

  if (updates.isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
    );
  }
  if (updates.isError) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <span>{t("projectUpdates:loadError")}</span>
        <Button variant="ghost" size="xs" onClick={() => updates.refetch()}>
          {t("projectUpdates:retry")}
        </Button>
      </div>
    );
  }
  const items = updates.data.pages.flatMap((page) => page.updates);
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-10 text-center">
        <Megaphone
          aria-hidden
          className="mx-auto mb-2 size-6 text-muted-foreground"
        />
        <p className="font-medium text-sm">{t("projectUpdates:empty.title")}</p>
        <p className="mt-1 text-muted-foreground text-sm">
          {t("projectUpdates:empty.description")}
        </p>
        {canPost && (
          <Button size="sm" className="mt-4" onClick={onCompose}>
            {t("projectUpdates:newUpdate")}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((update) => (
        <UpdateCard
          key={update.id}
          update={update}
          workspaceId={workspaceId}
          projectId={projectId}
          canComment={canPost}
        />
      ))}
      {updates.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            loading={updates.isFetchingNextPage}
            onClick={() => updates.fetchNextPage()}
          >
            {t("projectUpdates:loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The project's Updates section: dated status updates with a health value,
 * newest first. Posting, commenting and the composer's Draft button need
 * task:update; the weekly reminder needs project:update.
 */
export default function UpdatesScreen({ workspaceId, projectId }: ScreenProps) {
  const { t } = useTranslation();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { isEnabled } = useProjectFeatures({ projectId, workspaceId });
  const { canUpdateTasks, canUpdateProjects, isCheckingPermissions } =
    useWorkspacePermission();
  const canPost = !isCheckingPermissions && canUpdateTasks();
  const canManage = !isCheckingPermissions && canUpdateProjects();
  const featureOn = isEnabled("updates");
  const [composing, setComposing] = useState(false);

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeSection="updates"
      headerActions={
        canPost && featureOn && !composing ? (
          <Button
            size="xs"
            className="gap-1"
            onClick={() => setComposing(true)}
          >
            <Plus className="size-3" />
            <TopBarLabel>{t("projectUpdates:newUpdate")}</TopBarLabel>
          </Button>
        ) : null
      }
    >
      <PageTitle
        title={t("projectUpdates:documentTitle", {
          project: project?.name ?? "",
        })}
        hideAppName
      />
      <ProjectFeatureGate
        projectId={projectId}
        workspaceId={workspaceId}
        feature="updates"
      >
        <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <FollowButton projectId={projectId} />
            {canManage && <ReminderControl projectId={projectId} />}
          </div>
          {composing && (
            <UpdateComposer
              projectId={projectId}
              onDone={() => setComposing(false)}
            />
          )}
          <Timeline
            workspaceId={workspaceId}
            projectId={projectId}
            canPost={canPost}
            onCompose={() => setComposing(true)}
          />
        </div>
      </ProjectFeatureGate>
    </ProjectLayout>
  );
}
