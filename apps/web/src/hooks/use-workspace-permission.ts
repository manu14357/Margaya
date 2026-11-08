import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import useProjectRights from "@/hooks/queries/project/use-project-rights";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUser } from "@/hooks/queries/workspace-users/use-active-workspace-user";
import { useProjectScope } from "@/hooks/use-project-scope";
import { authClient } from "@/lib/auth-client";
import { isGuestRole } from "@/lib/guest-access";

export type PermissionLevel = "owner" | "admin" | "member";

// Capabilities are named permission bundles checked against the SERVER via
// better-auth's `/organization/has-permission` endpoint. Going through the
// server is what makes custom workspace roles work in the UI: the local
// `checkRolePermission` only knows about the four static roles compiled
// into the auth client, so it would silently return false for any custom
// role that grants the permission.
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

// A permission check is a read. Better Auth's client otherwise toggles its
// active-organization signal after every `/organization/*` call, so each of
// the checks below made the active workspace store refetch
// get-full-organization (a burst of ~38, which turned into 401s when the
// user signed out meanwhile).
const READ_ONLY = { disableSignal: true } as const;

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

/**
 * What I may do, asked of the server. Inside a project (ProjectScope: project
 * routes, a task sheet) the project's capabilities are also capped by my
 * project role there, as the API caps them: a guest, or a restricted
 * project's member, added as viewer gets no edit controls in that project.
 */
export function useWorkspacePermission() {
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: activeMember } = useGetActiveWorkspaceUser();
  const workspaceId = activeWorkspace?.id;
  const role = activeMember?.role as string | undefined;
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

  // One query that fans out to all capability checks in parallel and caches
  // the resulting map by (workspaceId, role). Refetches when either changes,
  // e.g., when the admin edits the role's permissions in the Roles UI and
  // we invalidate this key.
  const {
    data: capabilities,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["workspace-capabilities", workspaceId, role],
    enabled: Boolean(workspaceId && role),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CapabilityMap> => {
      const entries = Object.entries(CAPABILITIES) as Array<
        [Capability, Record<string, string[]>]
      >;
      const results = await Promise.all(
        entries.map(async ([key, permissions]) => {
          try {
            const res = await authClient.organization.hasPermission({
              organizationId: workspaceId,
              permissions,
              fetchOptions: READ_ONLY,
            });
            return [key, res.data?.success === true] as const;
          } catch (error) {
            console.error(`hasPermission check failed for ${key}:`, error);
            return [key, false] as const;
          }
        }),
      );
      const map = emptyCapabilityMap();
      for (const [key, value] of results) {
        map[key] = value;
      }
      return map;
    },
  });

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
      // Escape hatch for ad-hoc permission checks (uncached). Prefer adding
      // a capability above.
      hasPermission: async (permissions: Record<string, string[]>) => {
        try {
          const res = await authClient.organization.hasPermission({
            organizationId: workspaceId,
            permissions,
            fetchOptions: READ_ONLY,
          });
          return (
            res.data?.success === true &&
            (!ceiling || grants(ceiling, permissions))
          );
        } catch (error) {
          console.error("hasPermission check failed:", error);
          return false;
        }
      },
    };
  }, [can, ceiling, workspaceId]);

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
      (Boolean(workspaceId && role) && (isLoading || !capabilities)) ||
      rightsPending,
    isRefetchingPermissions: isFetching,
  };
}
