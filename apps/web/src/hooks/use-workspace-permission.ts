import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUser } from "@/hooks/queries/workspace-users/use-active-workspace-user";
import { authClient } from "@/lib/auth-client";

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

type Capability = keyof typeof CAPABILITIES;

type CapabilityMap = Record<Capability, boolean>;

function emptyCapabilityMap(): CapabilityMap {
  const out = {} as CapabilityMap;
  for (const key of Object.keys(CAPABILITIES) as Capability[]) {
    out[key] = false;
  }
  return out;
}

export function useWorkspacePermission() {
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: activeMember } = useGetActiveWorkspaceUser();
  const workspaceId = activeWorkspace?.id;
  const role = activeMember?.role as string | undefined;

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

  const can: CapabilityMap = capabilities ?? emptyCapabilityMap();

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
          return res.data?.success === true;
        } catch (error) {
          console.error("hasPermission check failed:", error);
          return false;
        }
      },
    };
  }, [can, workspaceId]);

  return {
    ...helpers,
    workspace: activeWorkspace,
    member: activeMember,
    role,
    isOwner: role === "owner",
    isAdmin: role === "owner" || role === "admin",
    // True while the first capability fetch is in flight. Useful for hiding
    // action UI during the initial render instead of flashing it on then
    // off when the server check resolves.
    isCheckingPermissions:
      Boolean(workspaceId && role) && (isLoading || !capabilities),
    isRefetchingPermissions: isFetching,
  };
}
