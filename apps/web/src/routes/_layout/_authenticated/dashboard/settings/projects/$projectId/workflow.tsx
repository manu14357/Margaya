import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import RuleCompiler from "@/components/ai/rules/rule-compiler";
import AutomationRules from "@/components/project/automation-rules/automation-rules";
import ColumnEditor, {
  SortColumnsByGroupButton,
} from "@/components/project/column-editor";
import CustomFieldEditor from "@/components/project/custom-field-editor";
import ScheduledAutomations from "@/components/project/scheduled-automations/scheduled-automations";
import TaskTemplates from "@/components/project/task-templates/task-templates";
import WorkflowEditor from "@/components/project/workflow-editor";
import { SettingsPage, SettingsSection } from "@/components/settings-layout";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/workflow",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();

  return (
    <SettingsPage
      title={t("settings:projectWorkflow.title")}
      documentTitle={t("settings:projectWorkflow.pageTitle")}
      description={t("settings:projectWorkflow.subtitle")}
    >
      <SettingsSection
        title={t("settings:projectWorkflow.columnsTitle")}
        description={t("settings:projectWorkflow.columnsDescription")}
        actions={<SortColumnsByGroupButton projectId={projectId} />}
      >
        <ColumnEditor projectId={projectId} />
      </SettingsSection>

      <SettingsSection
        title={t("settings:projectWorkflow.customFieldsTitle")}
        description={t("settings:projectWorkflow.customFieldsDescription")}
      >
        <CustomFieldEditor projectId={projectId} />
      </SettingsSection>

      <SettingsSection
        title={t("settings:automationRules.title")}
        description={t("settings:automationRules.description")}
      >
        <AutomationRules projectId={projectId} />
      </SettingsSection>

      <RuleCompiler projectId={projectId} />

      <SettingsSection
        title={t("settings:projectWorkflow.automationTitle")}
        description={t("settings:projectWorkflow.automationDescription")}
      >
        <WorkflowEditor projectId={projectId} />
      </SettingsSection>

      <SettingsSection
        title={t("settings:projectAutomations.title")}
        description={t("settings:projectAutomations.description")}
      >
        <ScheduledAutomations projectId={projectId} />
      </SettingsSection>

      <SettingsSection
        title={t("templates:settings.title")}
        description={t("templates:settings.description")}
      >
        <TaskTemplates projectId={projectId} />
      </SettingsSection>
    </SettingsPage>
  );
}
