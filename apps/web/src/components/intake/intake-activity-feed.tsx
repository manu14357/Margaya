import { useTranslation } from "react-i18next";
import Activity from "@/components/activity";
import CommentInput from "@/components/activity/comment-input";
import { isCommentActivity } from "@/components/activity/utils";
import { Timeline } from "@/components/ui/timeline";
import useGetActivitiesByTaskId from "@/hooks/queries/activity/use-get-activities-by-task-id";

/**
 * The request's history and comments, as on the task page. Commenting
 * needs task:update, like everywhere else.
 */
export default function IntakeActivityFeed({
  taskId,
  canComment,
}: {
  taskId: string;
  canComment: boolean;
}) {
  const { t } = useTranslation();
  const { data: activities = [] } = useGetActivitiesByTaskId(taskId);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-semibold text-md">{t("tasks:detail.activity")}</h2>
      {canComment && <CommentInput taskId={taskId} />}
      {activities.length > 0 ? (
        <Timeline>
          {activities.map((activity, index) => {
            const next = activities[index + 1];
            return (
              <Activity
                key={activity.id}
                activity={activity}
                step={activities.length - index}
                showConnector={
                  !isCommentActivity(activity) &&
                  Boolean(next) &&
                  !isCommentActivity(next)
                }
              />
            );
          })}
        </Timeline>
      ) : (
        <p className="font-medium text-muted-foreground text-sm">
          {t("tasks:detail.noActivity")}
        </p>
      )}
    </div>
  );
}
