import type { IntegrationPlugin } from "../types";
import { validateSlackConfig } from "./config";
import {
  handleIntakeDecided,
  handleProjectUpdatePosted,
  handleTaskCommentCreated,
  handleTaskCreated,
  handleTaskDescriptionChanged,
  handleTaskDueDateChanged,
  handleTaskPriorityChanged,
  handleTaskStatusChanged,
  handleTaskTitleChanged,
} from "./events";

export const slackPlugin: IntegrationPlugin = {
  type: "slack",
  name: "Slack",
  onTaskCreated: handleTaskCreated,
  onTaskStatusChanged: handleTaskStatusChanged,
  onTaskPriorityChanged: handleTaskPriorityChanged,
  onTaskTitleChanged: handleTaskTitleChanged,
  onTaskDescriptionChanged: handleTaskDescriptionChanged,
  onTaskCommentCreated: handleTaskCommentCreated,
  onTaskDueDateChanged: handleTaskDueDateChanged,
  onIntakeDecided: handleIntakeDecided,
  onProjectUpdatePosted: handleProjectUpdatePosted,
  validateConfig: validateSlackConfig,
};
