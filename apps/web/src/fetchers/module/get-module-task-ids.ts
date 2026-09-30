import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

const PAGE_SIZE = 100;

/**
 * Every visible task id of one module, page by page. The task map leaves
 * archived modules out, so an archived module's page reads its tasks here.
 */
async function getModuleTaskIds(moduleId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; ; page += 1) {
    const response = await client.module[":id"].tasks.$get({
      param: { id: moduleId },
      query: { page: String(page), limit: String(PAGE_SIZE) },
    });

    if (!response.ok) {
      throw new HttpError(response.status, await response.text());
    }

    const { tasks, pagination } = await response.json();
    ids.push(...tasks.map((task) => task.id));
    if (page >= pagination.totalPages) return ids;
  }
}

export default getModuleTaskIds;
