import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

async function updateTaskPosition(
  taskId: string,
  placement: { position: number; status?: string },
) {
  const response = await client.task.position[":id"].$put({
    param: { id: taskId },
    json: { position: placement.position, status: placement.status },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  const data = await response.json();

  return data;
}

export default updateTaskPosition;
