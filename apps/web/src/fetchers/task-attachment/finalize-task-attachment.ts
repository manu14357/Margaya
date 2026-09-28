import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

/** Step 3 of 3: records the uploaded object as an attachment. */
async function finalizeTaskAttachment(
  taskId: string,
  upload: { key: string; filename: string; contentType: string; size: number },
) {
  const response = await client["task-attachment"][":taskId"].finalize.$post({
    param: { taskId },
    json: upload,
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default finalizeTaskAttachment;
