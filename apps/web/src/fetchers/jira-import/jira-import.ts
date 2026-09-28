import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

type ImportBody = InferRequestType<
  (typeof client)["jira-import"][":projectId"]["$post"]
>["json"];

export type JiraImportOptions = NonNullable<ImportBody["options"]>;

/** The browser's time zone: Jira writes local times without an offset. */
function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Reads a Jira CSV export on the server without importing it. */
export async function previewJiraImport(projectId: string, content: string) {
  const response = await client["jira-import"][":projectId"].preview.$post({
    param: { projectId },
    json: { content, timeZone: browserTimeZone() },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function importJiraIssues({
  projectId,
  content,
  options,
}: {
  projectId: string;
  content: string;
  options: JiraImportOptions;
}) {
  const response = await client["jira-import"][":projectId"].$post({
    param: { projectId },
    json: { content, timeZone: browserTimeZone(), options },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export type JiraImportPreview = Awaited<ReturnType<typeof previewJiraImport>>;
export type JiraImportResult = Awaited<ReturnType<typeof importJiraIssues>>;
