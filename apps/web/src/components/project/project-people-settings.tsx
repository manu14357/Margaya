import { useTranslation } from "react-i18next";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from "@/components/settings-layout";
import useUpdateProject from "@/hooks/mutations/project/use-update-project";
import useProjectPeople from "@/hooks/queries/project/use-project-people";
import { toast } from "@/lib/toast";
import ProjectMemberPicker from "./project-member-picker";

type PeopleField = "leadUserId" | "defaultAssigneeUserId";

/** Project settings: the lead and the default assignee. */
export default function ProjectPeopleSettings({
  workspaceId,
  projectId,
  canEdit,
}: {
  workspaceId: string;
  projectId: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { project, leadUserId, defaultAssigneeUserId, isError } =
    useProjectPeople(workspaceId, projectId);
  const { mutateAsync, isPending } = useUpdateProject();

  const save = async (field: PeopleField, userId: string | null) => {
    if (!project) return;
    try {
      // The update replaces the profile fields, so send what the server has.
      await mutateAsync({
        id: project.id,
        name: project.name,
        icon: project.icon ?? "Layout",
        slug: project.slug,
        description: project.description ?? "",
        isPublic: !!project.isPublic,
        [field]: userId,
      });
      toast.success(t("settings:projectPeople.toastUpdated"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:projectPeople.toastError"),
      );
    }
  };

  const disabled = !canEdit || !project || isPending;

  return (
    <SettingsSection
      title={t("settings:projectPeople.title")}
      description={
        isError
          ? t("settings:projectPeople.loadError")
          : t("settings:projectPeople.subtitle")
      }
    >
      <SettingsGroup>
        <SettingsRow
          label={t("settings:projectPeople.leadLabel")}
          description={t("settings:projectPeople.leadHint")}
          htmlFor="project-lead"
        >
          <ProjectMemberPicker
            id="project-lead"
            workspaceId={workspaceId}
            value={leadUserId}
            onChange={(userId) => save("leadUserId", userId)}
            label={t("settings:projectPeople.leadLabel")}
            noneLabel={t("settings:projectPeople.noLead")}
            disabled={disabled}
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings:projectPeople.defaultAssigneeLabel")}
          description={t("settings:projectPeople.defaultAssigneeHint")}
          htmlFor="project-default-assignee"
        >
          <ProjectMemberPicker
            id="project-default-assignee"
            workspaceId={workspaceId}
            value={defaultAssigneeUserId}
            onChange={(userId) => save("defaultAssigneeUserId", userId)}
            label={t("settings:projectPeople.defaultAssigneeLabel")}
            noneLabel={t("settings:projectPeople.noDefaultAssignee")}
            disabled={disabled}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
