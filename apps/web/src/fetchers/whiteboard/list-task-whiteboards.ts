import { client } from "@margaya/libs";
import { responseError } from "./response-error";

/** Boards the caller can see that hold a card for the task. */
async function listTaskWhiteboards(taskId: string) {
  const response = await client.whiteboard["by-task"][":taskId"].$get({
    param: { taskId },
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export default listTaskWhiteboards;
