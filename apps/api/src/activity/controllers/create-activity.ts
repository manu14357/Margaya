import { withAgentVia } from "../../ai-agent/attribution";
import { withAutomationMarker } from "../../automation-rule/context";
import db from "../../database";
import { activityTable } from "../../database/schema";

async function createActivity(
  taskId: string,
  type: string,
  userId: string,
  content: string | null,
  eventData?: Record<string, unknown> | null,
) {
  const [activity] = await db
    .insert(activityTable)
    .values({
      taskId,
      type,
      userId,
      content,
      // "by Agent X on behalf of Y" when an agent's run key made the change.
      // "Automation" when a project automation rule made it.
      eventData: withAutomationMarker(withAgentVia(eventData)),
    })
    .returning();
  return activity;
}

export default createActivity;
