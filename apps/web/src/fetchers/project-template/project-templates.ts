import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// The built-in template gallery (GET /project-template), one template's
// preview (GET /project-template/{id}) and the workspace starters. Their text
// comes resolved from the API in the requested locale, so the web never
// translates template names itself.

export type ProjectTemplateCatalog = InferResponseType<
  (typeof client)["project-template"]["$get"],
  200
>;
export type ProjectTemplateSummary =
  ProjectTemplateCatalog["templates"][number];
export type ProjectTemplateCategory =
  ProjectTemplateCatalog["categories"][number];

export type ProjectTemplatePreview = InferResponseType<
  (typeof client)["project-template"][":id"]["$get"],
  200
>;

export type WorkspaceStarter = InferResponseType<
  (typeof client)["project-template"]["starters"]["$get"],
  200
>["starters"][number];

export async function getProjectTemplates(
  locale: string,
): Promise<ProjectTemplateCatalog> {
  const response = await client["project-template"].$get({
    query: { locale },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()) as ProjectTemplateCatalog;
}

export async function getProjectTemplate(
  id: string,
  locale: string,
): Promise<ProjectTemplatePreview> {
  const response = await client["project-template"][":id"].$get({
    param: { id },
    query: { locale },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()) as ProjectTemplatePreview;
}

export async function getWorkspaceStarters(
  locale: string,
): Promise<WorkspaceStarter[]> {
  const response = await client["project-template"].starters.$get({
    query: { locale },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()).starters;
}
