import { useNavigate } from "@tanstack/react-router";
import { Inbox } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useGetIntakeItemByTask } from "@/hooks/queries/intake/use-get-intake-item-by-task";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { effectiveIntakeStatus, tabOfStatus } from "@/lib/intake";
import { formatSnoozeDay } from "@/lib/intake-snooze";

type IntakeTaskBannerProps = {
  taskId: string;
  projectId: string;
  workspaceId: string;
};

/**
 * On a task's page: a request still in intake says so and links to its
 * queue (its status can only change by accepting it there); an accepted
 * one names its requester. Renders nothing for other tasks.
 */
export default function IntakeTaskBanner({
  taskId,
  projectId,
  workspaceId,
}: IntakeTaskBannerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isEnabled } = useProjectFeatures({ projectId, workspaceId });
  const { data: item } = useGetIntakeItemByTask(taskId, {
    enabled: isEnabled("intake"),
  });

  if (!item) return null;
  const status = effectiveIntakeStatus(item);

  if (status === "accepted") {
    return (
      <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <Inbox className="size-3.5" />
        {t("intake:taskBanner.accepted", {
          name: item.submittedBy?.name ?? t("common:people.someone"),
        })}
      </p>
    );
  }

  const message =
    status === "snoozed"
      ? t("intake:taskBanner.snoozed", {
          date: item.snoozedUntil ? formatSnoozeDay(item.snoozedUntil) : "",
        })
      : t(`intake:taskBanner.${status}`);

  return (
    <Alert variant={status === "declined" ? "error" : "info"}>
      <Inbox />
      <AlertTitle className="font-normal">{message}</AlertTitle>
      <AlertAction>
        <Button
          variant="outline"
          size="xs"
          onClick={() =>
            navigate({
              to: "/dashboard/workspace/$workspaceId/project/$projectId/intake",
              params: { workspaceId, projectId: item.projectId },
              search: {
                tab: tabOfStatus(status) === "closed" ? "closed" : undefined,
                item: item.id,
              },
            })
          }
        >
          {t("intake:taskBanner.open")}
        </Button>
      </AlertAction>
    </Alert>
  );
}
