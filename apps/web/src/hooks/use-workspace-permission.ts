import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import useProjectRights from "@/hooks/queries/project/use-project-rights";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { myWorkspacePermissionsQuery } from "@/hooks/queries/workspace/use-my-workspace-permissions";
import { useProjectScope } from "@/hooks/use-project-scope";
import { isGuestRole } from "@/lib/guest-access";

export type PermissionLevel = "owner" | "admin" | "member";

// Capabilities are named permission bundles checked against what the SERVER
// says I hold: one `GET /api/workspace/{id}/permissions` answers every
// permission with the API's own rules. Going through the server is what makes
// custom workspace roles work in the UI: the local `checkRolePermission` only
// knows about the static roles compiled into the auth client, so it would
// silently return false for any custom role that grants the permission.
const CAPABILITIES = {
  manageProjects: { project: ["create", "update", "delete"] },
  createProjects: { project: ["create"] },
  updateProjects: { project: ["update"] },
  deleteProjects: { project: ["delete"] },
  // Publish, unpublish and moderate a project's public board.
  shareProjects: { project: ["share"] },
  updateTasks: { task: ["update"] },
  createTasks: { task: ["create"] },
  deleteTasks: { task: ["delete"] },
  assignTasks: { task: ["assign"] },
  createLabels: { label: ["create"] },
  updateLabels: { label: ["update"] },
  deleteLabels: { label: ["delete"] },
  createCycles: { cycle: ["create"] },
  updateCycles: { cycle: ["update"] },
  deleteCycles: { cycle: ["delete"] },
  createModules: { module: ["create"] },
  updateModules: { module: ["update"] },
  deleteModules: { module: ["delete"] },
  createViews: { view: ["create"] },
  updateViews: { view: ["update"] },
  deleteViews: { view: ["delete"] },
  createIntake: { intake: ["create"] },
  readIntake: { intake: ["read"] },
  triageIntake: { intake: ["triage"] },
  readAnalytics: { analytics: ["read"] },
  readPages: { page: ["read"] },
  createPages: { page: ["create"] },
  updatePages: { page: ["update"] },
  deletePages: { page: ["delete"] },
  readWhiteboards: { whiteboard: ["read"] },
  createWhiteboards: { whiteboard: ["create"] },
  updateWhiteboards: { whiteboard: ["update"] },
  // Manage any board: lock, archive, trash, delete and publish it.
  deleteWhiteboards: { whiteboard: ["delete"] },
  manageWorkspace: { workspace: ["update", "manage_settings"] },
  // workspace:manage_settings alone: workspace webhooks, and everyone's
  // exports in the Exports history.
  manageWebhooks: { workspace: ["manage_settings"] },
  deleteWorkspace: { workspace: ["delete"] },
  // The workspace audit log (owners and admins by default).
  readAuditLog: { audit_log: ["read"] },
  // AI features, and the workspace's AI settings and usage.
  useAi: { ai: ["use"] },
  manageAi: { ai: ["manage"] },
  inviteUsers: { invitation: ["create"] },
  // Change a pending invitation's role (re-issuing it, in effect).
  manageInvitations: { invitation: ["create", "cancel"] },
  manageTeam: { member: ["update", "delete"] },
  removeMembers: { member: ["delete"] },
} as const satisfies Record<string, Record<string, string[]>>;

export type Capability = keyof typeof CAPABILITIES;

type CapabilityMap = Record<Capability, boolean>;

// About the workspace itself, so a project role never caps them.
const WORKSPACE_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "createProjects",
  "manageWorkspace",
  "manageWebhooks",
  "deleteWorkspace",
  "readAuditLog",
  "manageAi",
  "inviteUsers",
  "manageInvitations",
  "manageTeam",
  "removeMembers",
]);

type Statements = Record<string, readonly string[]>;

function grants(statements: Statements, required: Record<string, string[]>) {
  return Object.entries(required).every(([resource, actions]) =>
    actions.every((action) => statements[resource]?.includes(action)),
  );
}

function emptyCapabilityMap(): CapabilityMap {
  const out = {} as CapabilityMap;
  for (const key of Object.keys(CAPABILITIES) as Capability[]) {
    out[key] = false;
  }
  return out;
}

function toCapabilityMap(granted: Statements): CapabilityMap {
  const out = {} as CapabilityMap;
  for (const key of Object.keys(CAPABILITIES) as Capability[]) {
    out[key] = grants(granted, CAPABILITIES[key]);
  }
  return out;
}

/**
 * What I may do, asked of the server. Inside a project (ProjectScope: project
 * routes, a task sheet) the project's capabilities are also capped by my
 * project role there, as the API caps them: a guest, or a restricted
 * project's member, added as viewer gets no edit controls in that project.
 */
export function useWorkspacePermission() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: activeWorkspace } = useActiveWorkspace();
  const workspaceId = activeWorkspace?.id;
  const scopeProjectId = useProjectScope();
  // One map for the whole workspace, so a list over many projects (and each
  // of its rows) asks once.
  const rights = useProjectRights(workspaceId);
  const scopeRights = scopeProjectId
    ? (rights.data?.get(scopeProjectId) ?? null)
    : null;
  // Off until the project's rights load, as the workspace's are until
  // theirs do. If they can't load, the API still refuses what isn't allowed.
  const rightsPending =
    Boolean(scopeProjectId) && rights.isPending && !rights.isError;
  const ceiling: Statements | null = scopeRights?.statements ?? null;

  // One request for my role and every permission it grants, cached per
  // workspace. Role edits, role changes and membership changes invalidate it
  // (mutations, and WORKSPACE_MEMBERS_UPDATED on the user socket).
  const userId = user?.id;
  const permissionsQuery = useMemo(
    () => myWorkspacePermissionsQuery(workspaceId, userId),
    [workspaceId, userId],
  );
  const {
    data: mine,
    isPending,
    isError,
    isFetching,
  } = useQuery(permissionsQuery);
  const role = mine?.role;
  const activeMember = useMemo(
    () =>
      mine
        ? { userId: mine.userId, role: mine.role, createdAt: mine.joinedAt }
        : undefined,
    [mine],
  );
  const capabilities = useMemo(
    () => (mine ? toCapabilityMap(mine.permissions) : undefined),
    [mine],
  );

  const can: CapabilityMap = useMemo(() => {
    const base = capabilities ?? emptyCapabilityMap();
    if (!ceiling && !rightsPending) return base;
    const capped = { ...base };
    for (const key of Object.keys(CAPABILITIES) as Capability[]) {
      if (WORKSPACE_CAPABILITIES.has(key)) continue;
      capped[key] =
        base[key] &&
        !rightsPending &&
        (!ceiling || grants(ceiling, CAPABILITIES[key]));
    }
    return capped;
  }, [capabilities, ceiling, rightsPending]);

  const rightsData = rights.data;
  const rightsLoading = rights.isPending && !rights.isError;
  // A task's own project, for lists over many projects whose rows don't each
  // run this hook: the workspace's answer capped by my role there.
  const canInProject = useCallback(
    (projectId: string | null | undefined, capability: Capability) => {
      const base = capabilities?.[capability] ?? false;
      if (!base || WORKSPACE_CAPABILITIES.has(capability)) return base;
      if (rightsLoading) return false;
      const statements = projectId
        ? rightsData?.get(projectId)?.statements
        : undefined;
      return !statements || grants(statements, CAPABILITIES[capability]);
    },
    [capabilities, rightsData, rightsLoading],
  );

  const helpers = useMemo(() => {
    return {
      canManageProjects: () => can.manageProjects,
      canCreateProjects: () => can.createProjects,
      canUpdateProjects: () => can.updateProjects,
      canDeleteProjects: () => can.deleteProjects,
      canShareProjects: () => can.shareProjects,
      canUpdateTasks: () => can.updateTasks,
      canCreateTasks: () => can.createTasks,
      canDeleteTasks: () => can.deleteTasks,
      canAssignTasks: () => can.assignTasks,
      canCreateLabels: () => can.createLabels,
      canUpdateLabels: () => can.updateLabels,
      canDeleteLabels: () => can.deleteLabels,
      canCreateCycles: () => can.createCycles,
      canUpdateCycles: () => can.updateCycles,
      canDeleteCycles: () => can.deleteCycles,
      canCreateModules: () => can.createModules,
      canUpdateModules: () => can.updateModules,
      canDeleteModules: () => can.deleteModules,
      canCreateViews: () => can.createViews,
      canUpdateViews: () => can.updateViews,
      canDeleteViews: () => can.deleteViews,
      canCreateIntake: () => can.createIntake,
      canReadIntake: () => can.readIntake,
      canTriageIntake: () => can.triageIntake,
      canReadAnalytics: () => can.readAnalytics,
      canReadPages: () => can.readPages,
      canCreatePages: () => can.createPages,
      canUpdatePages: () => can.updatePages,
      canDeletePages: () => can.deletePages,
      canReadWhiteboards: () => can.readWhiteboards,
      canCreateWhiteboards: () => can.createWhiteboards,
      canUpdateWhiteboards: () => can.updateWhiteboards,
      canDeleteWhiteboards: () => can.deleteWhiteboards,
      canManageWorkspace: () => can.manageWorkspace,
      canManageWebhooks: () => can.manageWebhooks,
      canDeleteWorkspace: () => can.deleteWorkspace,
      canReadAuditLog: () => can.readAuditLog,
      canUseAi: () => can.useAi,
      canManageAi: () => can.manageAi,
      canInviteUsers: () => can.inviteUsers,
      canManageInvitations: () => can.manageInvitations,
      canManageTeam: () => can.manageTeam,
      canRemoveMembers: () => can.removeMembers,
      // Escape hatch for ad-hoc permission checks, answered from the same
      // cached permissions. Prefer adding a capability above.
      hasPermission: async (permissions: Record<string, string[]>) => {
        if (!permissionsQuery.enabled) return false;
        try {
          const granted = await queryClient.ensureQueryData(permissionsQuery);
          return (
            grants(granted.permissions, permissions) &&
            (!ceiling || grants(ceiling, permissions))
          );
        } catch (error) {
          console.error("hasPermission check failed:", error);
          return false;
        }
      },
    };
  }, [can, ceiling, permissionsQuery, queryClient]);

  return {
    ...helpers,
    workspace: activeWorkspace,
    member: activeMember,
    role,
    isOwner: role === "owner",
    isAdmin: role === "owner" || role === "admin",
    isGuest: isGuestRole(role),
    // My role in the scope project when it caps my rights there, else null.
    projectRole: scopeRights?.projectRole ?? null,
    canInProject,
    // True while the first capability fetch is in flight. Useful for hiding
    // action UI during the initial render instead of flashing it on then
    // off when the server check resolves.
    isCheckingPermissions:
      (Boolean(permissionsQuery.enabled) && isPending && !isError) ||
      rightsPending,
    isRefetchingPermissions: isFetching,
  };
}
