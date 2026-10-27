import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

// Saved page templates of a project (its own and the workspace's).

async function ensureOk(response: Response) {
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
}

export async function listPageTemplates(projectId: string) {
  const response = await client.page.project[":projectId"].templates.$get({
    param: { projectId },
  });
  await ensureOk(response);
  return response.json();
}

export async function savePageAsTemplate(
  pageId: string,
  json: { name: string; scope: "project" | "workspace" },
) {
  const response = await client.page[":id"].template.$post({
    param: { id: pageId },
    json,
  });
  await ensureOk(response);
  return response.json();
}

export async function deletePageTemplate(templateId: string) {
  const response = await client.page.template[":templateId"].$delete({
    param: { templateId },
  });
  await ensureOk(response);
  return response.json();
}

export type PageTemplate = Awaited<
  ReturnType<typeof listPageTemplates>
>[number];
