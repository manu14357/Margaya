import { useTranslation } from "react-i18next";
import { SettingsRow } from "@/components/settings-layout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { CalendarFeed } from "@/fetchers/calendar-feed/calendar-feeds";
import { useCreateProjectCalendarFeed } from "@/hooks/mutations/calendar-feed/use-calendar-feed-mutations";
import useCalendarFeeds from "@/hooks/queries/calendar-feed/use-calendar-feeds";
import {
  CalendarFeedActions,
  CalendarFeedStatus,
} from "./calendar-feed-actions";

function useProjectFeedCreate(
  projectId: string,
  projectName: string,
  workspaceName: string,
) {
  const { t } = useTranslation();
  const createFeed = useCreateProjectCalendarFeed();
  return () =>
    createFeed.mutateAsync({
      projectId,
      name: t("settings:calendarFeed.calendarName.project", {
        project: projectName,
        workspace: workspaceName,
      }),
    });
}

/** A project feed in account settings; a now-hidden project shows unnamed. */
export function ProjectCalendarFeedRow({
  feed,
  workspaceName,
}: {
  feed: CalendarFeed;
  workspaceName: string;
}) {
  const { t } = useTranslation();
  const projectName =
    feed.projectName ?? t("settings:calendarFeed.hiddenProject");
  const create = useProjectFeedCreate(
    feed.projectId ?? "",
    projectName,
    workspaceName,
  );
  return (
    <SettingsRow
      label={projectName}
      description={t("settings:calendarFeed.project.settingsDescription")}
      note={<CalendarFeedStatus feed={feed} />}
    >
      <CalendarFeedActions
        feed={feed}
        label={projectName}
        create={create}
        // A project the owner can't see any more can only be revoked.
        canRegenerate={feed.projectName !== null}
      />
    </SettingsRow>
  );
}

type ProjectCalendarFeedDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceName: string;
  project: { id: string; name: string } | null;
};

/** "Subscribe in calendar" from the project menu. */
export function ProjectCalendarFeedDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  project,
}: ProjectCalendarFeedDialogProps) {
  const { t } = useTranslation();
  const {
    data: feeds,
    isLoading,
    isError,
  } = useCalendarFeeds(open ? workspaceId : undefined);
  const feed = feeds?.find(
    (candidate) =>
      candidate.kind === "project" && candidate.projectId === project?.id,
  );
  const create = useProjectFeedCreate(
    project?.id ?? "",
    project?.name ?? "",
    workspaceName,
  );

  return (
    <Dialog open={open && project !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings:calendarFeed.title")}</DialogTitle>
          <DialogDescription>
            {t("settings:calendarFeed.project.dialogDescription", {
              project: project?.name ?? "",
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-3">
          {isLoading ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-8 w-28" />
            </div>
          ) : isError ? (
            <p className="text-destructive text-sm">
              {t("settings:calendarFeed.loadError")}
            </p>
          ) : (
            <>
              <p className="text-sm">
                <CalendarFeedStatus feed={feed} />
              </p>
              <div className="flex flex-wrap gap-2">
                <CalendarFeedActions
                  feed={feed}
                  label={project?.name ?? ""}
                  create={create}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                {t("settings:calendarFeed.project.manageHint")}
              </p>
            </>
          )}
        </DialogPanel>
      </DialogContent>
    </Dialog>
  );
}
