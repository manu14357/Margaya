import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useWorkspaceRoles from "@/hooks/queries/workspace/use-workspace-roles";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import InviteRoleSelect from "./invite-role-select";

export type GuestProject = { projectId: string; role: string };

const BUILT_IN_PROJECT_ROLES = ["viewer", "member", "admin"] as const;
const RESERVED = new Set<string>(["owner", "guest", ...BUILT_IN_PROJECT_ROLES]);
/** A guest added from the invitation reads only until given more. */
export const DEFAULT_GUEST_PROJECT_ROLE = "viewer";

type Props = {
  workspaceId: string;
  value: GuestProject[];
  onChange: (value: GuestProject[]) => void;
  disabled?: boolean;
};

/**
 * The projects a guest joins on accepting, each with a project role. Only
 * projects the inviter may share are offered (project:share, or their lead);
 * the API checks the same.
 */
function InviteGuestProjects({
  workspaceId,
  value,
  onChange,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const id = useId();
  const { user } = useAuth();
  const { canShareProjects } = useWorkspacePermission();
  const { data: projects = [], isLoading } = useGetProjects({ workspaceId });
  const { data: workspaceRoles = [] } = useWorkspaceRoles(workspaceId);
  const roles = useMemo(
    () => [
      ...BUILT_IN_PROJECT_ROLES,
      ...workspaceRoles
        .map((role) => role.role)
        .filter((role) => !RESERVED.has(role)),
    ],
    [workspaceRoles],
  );
  const sharable = projects.filter(
    (project) =>
      !project.archivedAt &&
      (canShareProjects() ||
        (user?.id !== undefined && project.leadUserId === user.id)),
  );
  const picked = new Map(value.map((entry) => [entry.projectId, entry.role]));

  const toggle = (projectId: string, checked: boolean) =>
    onChange(
      checked
        ? [...value, { projectId, role: DEFAULT_GUEST_PROJECT_ROLE }]
        : value.filter((entry) => entry.projectId !== projectId),
    );
  const setRole = (projectId: string, role: string) =>
    onChange(
      value.map((entry) =>
        entry.projectId === projectId ? { ...entry, role } : entry,
      ),
    );

  return (
    <fieldset className="grid gap-1.5" aria-describedby={`${id}-hint`}>
      <legend className="mb-1.5 font-medium text-sm">
        {t("team:inviteModal.guestProjectsLabel")}
      </legend>
      {!isLoading && sharable.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          {t("team:inviteModal.guestProjectsEmpty")}
        </p>
      ) : (
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
          {sharable.map((project) => {
            const role = picked.get(project.id);
            const checkboxId = `${id}-project-${project.id}`;
            return (
              <li
                key={project.id}
                className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11"
              >
                <Checkbox
                  id={checkboxId}
                  checked={role !== undefined}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    toggle(project.id, checked === true)
                  }
                />
                <Label
                  htmlFor={checkboxId}
                  className="min-w-0 flex-1 truncate font-normal text-sm"
                >
                  {project.name}
                </Label>
                {role !== undefined && (
                  <InviteRoleSelect
                    roles={roles}
                    value={role}
                    onChange={(next) => setRole(project.id, next)}
                    disabled={disabled}
                    size="sm"
                    className="h-8 w-28"
                    aria-label={t("team:inviteModal.guestProjectRoleFor", {
                      project: project.name,
                    })}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p id={`${id}-hint`} className="text-muted-foreground text-xs">
        {t("team:inviteModal.guestProjectsHint")}
      </p>
    </fieldset>
  );
}

export default InviteGuestProjects;
