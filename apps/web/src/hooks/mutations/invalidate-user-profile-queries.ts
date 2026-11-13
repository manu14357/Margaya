import type { QueryClient } from "@tanstack/react-query";
import { invalidateTaskQueries } from "@/lib/task-query/cache";

/**
 * Every query that shows a person's name, avatar or email: member lists and
 * pickers, tasks and their history, comments, reactions, the inbox, planning
 * leads, pages, intake and the audit log. Only queries on screen refetch;
 * the rest refetch when they are next shown.
 */
export const USER_PROFILE_QUERY_KEYS = [
  ["active-workspace-users"],
  ["workspace-users"],
  ["workspace-member"],
  ["workspace-user"],
  ["workspace", "full"],
  ["project-access"],
  ["project-audience"],
  ["ai-agents"],
  ["activities"],
  ["tasks"],
  ["task"],
  ["comments"],
  ["reactions"],
  ["notifications"],
  ["time-entries"],
  ["task-attachments"],
  ["task-relations"],
  ["task-description-versions"],
  ["cycles"],
  ["modules"],
  ["pages"],
  ["page"],
  ["intake-items"],
  ["intake-item"],
  ["audit-log"],
  ["search"],
] as const;

export async function invalidateUserProfileQueries(queryClient: QueryClient) {
  await Promise.all([
    ...USER_PROFILE_QUERY_KEYS.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
    // Filtered lists, spreadsheets, views and "My work".
    invalidateTaskQueries(queryClient),
  ]);
}

export default invalidateUserProfileQueries;
