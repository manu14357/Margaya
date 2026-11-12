import { useTranslation } from "react-i18next";
import {
  SettingsGroup,
  SettingsGroupMessage,
  SettingsRow,
  SettingsSection,
} from "@/components/settings-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateWorkspaceCalendarFeed } from "@/hooks/mutations/calendar-feed/use-calendar-feed-mutations";
import useCalendarFeeds from "@/hooks/queries/calendar-feed/use-calendar-feeds";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import {
  CalendarFeedActions,
  CalendarFeedStatus,
} from "./calendar-feed-actions";
import { ProjectCalendarFeedRow } from "./project-calendar-feed";

/**
 * "Subscribe in calendar" in account settings: the active workspace's
 * "my tasks" and "milestones and cycles" feeds, plus any project feeds made
 * from the project menu, each with regenerate and revoke.
 */
export default function CalendarFeedSettings() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { data: feeds, isLoading, isError } = useCalendarFeeds(workspaceId);
  const createFeed = useCreateWorkspaceCalendarFeed();
  const workspaceName = workspace?.name ?? "";

  const myTasks = feeds?.find((feed) => feed.kind === "my_tasks");
  const planning = feeds?.find((feed) => feed.kind === "planning");
  const projectFeeds = feeds?.filter((feed) => feed.kind === "project") ?? [];

  const myTasksLabel = t("settings:calendarFeed.myTasks.label");
  const planningLabel = t("settings:calendarFeed.planning.label");

  return (
    <SettingsSection
      title={t("settings:calendarFeed.title")}
      description={t("settings:calendarFeed.description")}
    >
      <SettingsGroup>
        {!workspaceId || isLoading ? (
          <div className="flex flex-col gap-2 px-4 py-3" aria-busy="true">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : isError ? (
          <SettingsGroupMessage tone="error">
            {t("settings:calendarFeed.loadError")}
          </SettingsGroupMessage>
        ) : (
          <>
            <SettingsRow
              label={myTasksLabel}
              description={t("settings:calendarFeed.myTasks.description")}
              note={<CalendarFeedStatus feed={myTasks} />}
            >
              <CalendarFeedActions
                feed={myTasks}
                label={myTasksLabel}
                create={() =>
                  createFeed.mutateAsync({
                    workspaceId,
                    kind: "my_tasks",
                    name: t("settings:calendarFeed.calendarName.myTasks", {
                      workspace: workspaceName,
                    }),
                  })
                }
              />
            </SettingsRow>
            <SettingsRow
              label={planningLabel}
              description={t("settings:calendarFeed.planning.description")}
              note={<CalendarFeedStatus feed={planning} />}
            >
              <CalendarFeedActions
                feed={planning}
                label={planningLabel}
                create={() =>
                  createFeed.mutateAsync({
                    workspaceId,
                    kind: "planning",
                    name: t("settings:calendarFeed.calendarName.planning", {
                      workspace: workspaceName,
                    }),
                  })
                }
              />
            </SettingsRow>
            {projectFeeds.map((feed) => (
              <ProjectCalendarFeedRow
                key={feed.id}
                feed={feed}
                workspaceName={workspaceName}
              />
            ))}
          </>
        )}
      </SettingsGroup>
      <p className="text-muted-foreground text-xs">
        {t("settings:calendarFeed.timezoneNote")}
      </p>
    </SettingsSection>
  );
}
