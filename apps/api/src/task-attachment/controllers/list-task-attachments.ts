import {
  isTaskAttachment,
  selectAttachments,
  toTaskAttachment,
} from "../queries";

/**
 * The task's panel attachments, newest first. Files inserted into the
 * description or comments are not listed; they belong to their text.
 */
async function listTaskAttachments(taskId: string, apiBaseUrl: string) {
  const rows = await selectAttachments(isTaskAttachment(taskId));
  return rows.map((row) => toTaskAttachment(row, apiBaseUrl));
}

export default listTaskAttachments;
