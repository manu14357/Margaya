import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  PeopleList,
  PersonAvatar,
  useWorkspacePeople,
} from "@/components/module/module-people";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import useProjectAccessMutation from "@/hooks/mutations/project/use-project-access";
import useProjectAccess from "@/hooks/queries/project/use-project-access";
import useWorkspaceRoles from "@/hooks/queries/workspace/use-workspace-roles";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { isGuestRole } from "@/lib/guest-access";
import { toast } from "@/lib/toast";

const BUILT_IN_ROLES = ["viewer", "member", "admin"] as const;
// Seeded rows of the built-in roles also come back from listRoles.
const RESERVED = new Set<string>(["owner", ...BUILT_IN_ROLES]);

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Project settings: open or restricted, and the project's members with their
 * project roles. In an open project the list only matters for guests, who
 * reach nothing else, so only they are offered there. The API decides who may
 * change it (project:share, or the project lead) and reports it as `canManage`.
 */
export default function ProjectAccessSettings({
  workspaceId,
  projectId,
}: {
  workspaceId: string;
  projectId: string;
}) {
  const { t } = useTranslation();
  const { data: access, isError } = useProjectAccess(projectId);
  const { mutateAsync, isPending } = useProjectAccessMutation(projectId);
  const people = useWorkspacePeople(workspaceId);
  const { data: workspaceMembers } = useGetActiveWorkspaceUsers(workspaceId);
  const { data: workspaceRoles = [] } = useWorkspaceRoles(workspaceId);
  const [adding, setAdding] = useState(false);

  const roles = useMemo(
    () => [
      ...BUILT_IN_ROLES,
      ...workspaceRoles
        .map((role) => role.role)
        .filter((role) => !RESERVED.has(role)),
    ],
    [workspaceRoles],
  );
  const roleLabel = (role: string) =>
    t(`team:roles.${role}`, { defaultValue: capitalize(role) });

  const memberIds = new Set(access?.members.map((m) => m.userId) ?? []);
  const restricted = access?.visibility === "restricted";
  const guestIds = new Set(
    workspaceMembers?.members
      .filter((member) => isGuestRole(member.role))
      .map((member) => member.userId),
  );
  const candidates = people.filter(
    (person) =>
      !memberIds.has(person.id) && (restricted || guestIds.has(person.id)),
  );
  const disabled = !access?.canManage || isPending;

  const run = async (change: Parameters<typeof mutateAsync>[0]) => {
    try {
      await mutateAsync(change);
      toast.success(t("settings:projectAccess.toastUpdated"));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("settings:projectAccess.toastError"),
      );
    }
  };

  return (
    <SettingsSection
      title={t("settings:projectAccess.title")}
      description={
        isError
          ? t("settings:projectAccess.loadError")
          : t("settings:projectAccess.subtitle")
      }
    >
      <SettingsGroup>
        <SettingsRow
          label={t("settings:projectAccess.restrictedLabel")}
          description={
            restricted
              ? t("settings:projectAccess.restrictedHint")
              : t("settings:projectAccess.openHint")
          }
          htmlFor="project-restricted"
        >
          <Switch
            id="project-restricted"
            checked={restricted}
            disabled={!access || disabled}
            onCheckedChange={(checked) =>
              run({
                kind: "visibility",
                visibility: checked ? "restricted" : "open",
              })
            }
          />
        </SettingsRow>
        {access && (
          <SettingsRow
            label={t("settings:projectAccess.membersLabel")}
            description={
              restricted
                ? t("settings:projectAccess.membersHint")
                : t("settings:projectAccess.guestsHint")
            }
            stacked
          >
            <ul className="divide-y divide-border rounded-md border">
              {access.members.length === 0 && (
                <li className="px-3 py-2 text-muted-foreground text-sm">
                  {t("settings:projectAccess.noMembers")}
                </li>
              )}
              {access.members.map((member) => (
                <li
                  key={member.userId}
                  className="flex min-w-0 items-center gap-2 px-3 py-2"
                >
                  <PersonAvatar person={member} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {member.name}
                    {member.userId === access.leadUserId && (
                      <span className="ml-2 text-muted-foreground text-xs">
                        {t("settings:projectAccess.leadTag")}
                      </span>
                    )}
                  </span>
                  <Select
                    value={member.role}
                    disabled={disabled}
                    onValueChange={(value) => {
                      if (typeof value === "string" && value !== member.role) {
                        void run({
                          kind: "role",
                          userId: member.userId,
                          role: value,
                        });
                      }
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-8 w-28"
                      aria-label={t("settings:projectAccess.roleFor", {
                        name: member.name,
                      })}
                    >
                      <SelectValue>{roleLabel(member.role)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role} value={role}>
                          {roleLabel(role)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    disabled={disabled}
                    aria-label={t("settings:projectAccess.removeMember", {
                      name: member.name,
                    })}
                    onClick={() =>
                      run({ kind: "remove", userId: member.userId })
                    }
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
            {access.canManage && (
              <Popover open={adding} onOpenChange={setAdding}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 w-fit"
                    disabled={disabled}
                  >
                    <Plus className="size-3.5" />
                    {t("settings:projectAccess.addMember")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <PeopleList
                    people={candidates}
                    isSelected={() => false}
                    onSelect={(userId) => {
                      setAdding(false);
                      // Read-only until someone chooses otherwise: a guest is
                      // usually an outside reader.
                      void run({
                        kind: "add",
                        userId,
                        role: guestIds.has(userId) ? "viewer" : "member",
                      });
                    }}
                  />
                </PopoverContent>
              </Popover>
            )}
          </SettingsRow>
        )}
      </SettingsGroup>
    </SettingsSection>
  );
}
