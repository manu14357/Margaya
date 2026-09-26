import useGetProjects from "./use-get-projects";

/**
 * A project's lead and default assignee, read from the workspace's project
 * list (already cached for the sidebar). Null while loading or unset.
 */
function useProjectPeople(workspaceId: string, projectId: string) {
  const query = useGetProjects({ workspaceId });
  const project = query.data?.find((item) => item.id === projectId);
  return {
    ...query,
    project,
    leadUserId: project?.leadUserId ?? null,
    defaultAssigneeUserId: project?.defaultAssigneeUserId ?? null,
  };
}

export default useProjectPeople;
