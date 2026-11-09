import { useMemo } from "react";
import type { MentionMember } from "@/components/task/extensions/mention-list";
import useProjectAudience from "@/hooks/queries/project/use-project-audience";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useProjectScope } from "@/hooks/use-project-scope";

/**
 * Whom an @mention offers: inside a project (ProjectScope) the people who can
 * see it, which a guest may list too; elsewhere the workspace's members.
 */
export function useMentionMembers(workspaceId: string): MentionMember[] {
  const projectId = useProjectScope();
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    projectId ? "" : workspaceId,
  );
  const { data: audience } = useProjectAudience(projectId);
  return useMemo(
    () =>
      projectId
        ? (audience ?? []).map((person) => ({
            id: person.id,
            label: person.name,
            image: person.image,
          }))
        : (workspaceUsers?.members ?? []).map((member) => ({
            id: member.userId,
            label: member.user?.name ?? member.user?.email ?? "",
            image: member.user?.image ?? null,
          })),
    [projectId, audience, workspaceUsers],
  );
}
