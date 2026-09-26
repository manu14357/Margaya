import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";
import type { AutomationRule } from "@/types/project-automation";

/** How many tasks a rule would take right now with these months. */
async function previewProjectAutomation(
  projectId: string,
  rule: AutomationRule,
  months: number,
) {
  const response = await client["project-automation"][
    ":projectId"
  ].preview.$get({
    param: { projectId },
    query: { rule, months: String(months) },
  });

  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }

  return response.json();
}

export default previewProjectAutomation;
