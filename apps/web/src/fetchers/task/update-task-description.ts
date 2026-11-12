import { client } from "@margaya/libs";
import { aiTextKeys, clearAiText, pendingAiAssist } from "@/lib/ai/provenance";
import { HttpError } from "@/lib/http-error";
import type Task from "@/types/task";

async function updateTaskDescription(taskId: string, task: Task) {
  // Text accepted from the editor's AI goes out labelled as AI-generated.
  const aiKey = aiTextKeys.taskDescription(taskId);
  const aiAssist = pendingAiAssist(aiKey);
  const response = await client.task.description[":id"].$put({
    param: { id: taskId },
    json: {
      description: task.description || "",
      ...(aiAssist ? { aiAssist } : {}),
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  if (aiAssist) clearAiText(aiKey);

  const data = await response.json();

  return data;
}

export default updateTaskDescription;
