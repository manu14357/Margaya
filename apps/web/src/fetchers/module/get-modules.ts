import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { ModuleListView } from "@/types/module";

async function getModules(projectId: string, view: ModuleListView = "active") {
  const response = await client.module.project[":projectId"].$get({
    param: { projectId },
    query: { view },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getModules;
