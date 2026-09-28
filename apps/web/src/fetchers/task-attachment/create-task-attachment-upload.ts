import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Step 1 of 3: a presigned PUT for the file's bytes. */
async function createTaskAttachmentUpload(
  taskId: string,
  file: { filename: string; contentType: string; size: number },
) {
  const response = await client["task-attachment"][":taskId"].upload.$post({
    param: { taskId },
    json: file,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default createTaskAttachmentUpload;
