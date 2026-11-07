import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDeleteWorkflowRule } from "@/hooks/mutations/workflow-rule/use-delete-workflow-rule";
import { useUpsertWorkflowRule } from "@/hooks/mutations/workflow-rule/use-upsert-workflow-rule";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { useGetWorkflowRules } from "@/hooks/queries/workflow-rule/use-get-workflow-rules";
import { toast } from "@/lib/toast";

const GITHUB_EVENT_TYPES = [
  "branch_push",
  "pr_opened",
  "pr_merged",
  "issue_opened",
  "issue_closed",
] as const;

type WorkflowEditorProps = {
  projectId: string;
};

export default function WorkflowEditor({ projectId }: WorkflowEditorProps) {
  const { t } = useTranslation();
  const { data: columns, isLoading: columnsLoading } = useGetColumns(projectId);
  const { data: rules, isLoading: rulesLoading } =
    useGetWorkflowRules(projectId);
  const { mutateAsync: upsertRule } = useUpsertWorkflowRule();
  const { mutateAsync: deleteRule, isPending: isRemoving } =
    useDeleteWorkflowRule();

  if (columnsLoading || rulesLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("settings:workflowEditor.loading")}
      </div>
    );
  }

  if (!columns || columns.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("settings:workflowEditor.createColumnsFirst")}
      </div>
    );
  }

  const removeRule = async (id: string) => {
    try {
      await deleteRule({ id, projectId });
      toast.success(t("settings:workflowEditor.toastRemoved"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:workflowEditor.toastRemoveError"),
      );
    }
  };

  const renderRuleSection = (
    integrationType: "github" | "gitea",
    headingKey: "githubHeading" | "giteaHeading",
    hintKey: "githubHint" | "giteaHint",
  ) => (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">
          {t(`settings:workflowEditor.${headingKey}`)}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t(`settings:workflowEditor.${hintKey}`)}
        </p>
      </div>

      <div className="space-y-2">
        {GITHUB_EVENT_TYPES.map((eventType) => {
          const currentRule = rules?.find(
            (r) =>
              r.integrationType === integrationType &&
              r.eventType === eventType,
          );

          return (
            <div
              key={`${integrationType}-${eventType}`}
              className="flex items-center justify-between gap-4 p-3 border border-border rounded-md bg-card"
            >
              <span className="text-sm">
                {t(`settings:workflowEditor.events.${eventType}`)}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                {currentRule && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={isRemoving}
                    aria-label={t("settings:workflowEditor.removeRule", {
                      event: t(`settings:workflowEditor.events.${eventType}`),
                    })}
                    onClick={() => removeRule(currentRule.id)}
                  >
                    <X aria-hidden />
                  </Button>
                )}
                <Select
                  value={currentRule?.columnId ?? ""}
                  onValueChange={async (value) => {
                    if (!value) return;
                    try {
                      await upsertRule({
                        projectId,
                        data: {
                          integrationType,
                          eventType,
                          columnId: value,
                        },
                      });
                      toast.success(t("settings:workflowEditor.toastUpdated"));
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : t("settings:workflowEditor.toastError"),
                      );
                    }
                  }}
                >
                  <SelectTrigger className="w-48 h-8 text-sm">
                    <SelectValue
                      placeholder={t(
                        "settings:workflowEditor.selectColumnPlaceholder",
                      )}
                    >
                      {columns.find((c) => c.id === currentRule?.columnId)
                        ?.name ??
                        t("settings:workflowEditor.selectColumnPlaceholder")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((col) => (
                      <SelectItem key={col.id} value={col.id}>
                        {col.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-10">
      {renderRuleSection("github", "githubHeading", "githubHint")}
      {renderRuleSection("gitea", "giteaHeading", "giteaHint")}
    </div>
  );
}
