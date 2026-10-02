import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { IntakeFilters } from "@/types/intake";

export const INTAKE_PAGE_SIZE = 50;

/** One page of a project's requests; lists travel as comma lists. */
async function getIntakeItems(
  projectId: string,
  filters: IntakeFilters,
  page = 1,
) {
  const response = await client.intake.project[":projectId"].$get({
    param: { projectId },
    query: {
      tab: filters.tab,
      status: filters.statuses.length ? filters.statuses.join(",") : undefined,
      priority: filters.priorities.length
        ? filters.priorities.join(",")
        : undefined,
      submittedBy: filters.submittedBy,
      search: filters.q,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
      page: String(page),
      limit: String(INTAKE_PAGE_SIZE),
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default getIntakeItems;
