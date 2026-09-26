import { Archive, CircleX } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useUpdateProjectAutomations } from "@/hooks/mutations/project-automation/use-update-project-automations";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { useFetchAutomationPreview } from "@/hooks/queries/project-automation/use-automation-preview";
import { useProjectAutomations } from "@/hooks/queries/project-automation/use-project-automations";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  cancelledColumns,
  isBroaderChange,
  type RuleSetting,
} from "@/lib/automation";
import { toast } from "@/lib/toast";
import type {
  AutomationRule,
  UpdateProjectAutomationsInput,
} from "@/types/project-automation";
import AutomationConfirmDialog, {
  type PendingAutomationChange,
} from "./automation-confirm-dialog";
import AutomationRuleRow from "./automation-rule-row";
import RuleSettings from "./rule-settings";

type ScheduledAutomationsProps = { projectId: string };

type ToastKey =
  | "settings:projectAutomations.toast.archiveOn"
  | "settings:projectAutomations.toast.archiveOff"
  | "settings:projectAutomations.toast.closeOn"
  | "settings:projectAutomations.toast.closeOff"
  | "settings:projectAutomations.toast.updated";

function toastKeyFor(
  rule: AutomationRule,
  current: RuleSetting,
  next: RuleSetting,
): ToastKey {
  if (current.enabled !== next.enabled) {
    if (rule === "archive") {
      return next.enabled
        ? "settings:projectAutomations.toast.archiveOn"
        : "settings:projectAutomations.toast.archiveOff";
    }
    return next.enabled
      ? "settings:projectAutomations.toast.closeOn"
      : "settings:projectAutomations.toast.closeOff";
  }
  return "settings:projectAutomations.toast.updated";
}

/**
 * Settings → Projects → Workflow → "Scheduled automations": auto-archive
 * closed tasks and auto-close stale ones, checked hourly (B11 §1.7).
 */
export default function ScheduledAutomations({
  projectId,
}: ScheduledAutomationsProps) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { data, isPending, isError, refetch } = useProjectAutomations(
    workspaceId,
    projectId,
  );
  const { data: columns } = useGetColumns(projectId);
  const cancelled = useMemo(() => cancelledColumns(columns ?? []), [columns]);
  const { canUpdateProjects, isCheckingPermissions } = useWorkspacePermission();
  const canEdit = !isCheckingPermissions && canUpdateProjects();
  const { mutateAsync: update } = useUpdateProjectAutomations();
  const fetchPreview = useFetchAutomationPreview(workspaceId, projectId);
  const [pending, setPending] = useState<PendingAutomationChange | null>(null);

  const save = async (patch: UpdateProjectAutomationsInput, key: ToastKey) => {
    try {
      await update({ workspaceId, projectId, patch });
      toast.success(t(key));
    } catch {
      toast.error(t("settings:projectAutomations.toast.error"));
    }
  };

  /**
   * Saves a rule change. A broader one (on, or fewer months) first counts
   * the tasks it would take and asks when there are any.
   */
  const change = async ({
    rule,
    current,
    next,
    patch,
    columnName,
  }: {
    rule: AutomationRule;
    current: RuleSetting;
    next: RuleSetting;
    patch: UpdateProjectAutomationsInput;
    columnName?: string;
  }) => {
    const key = toastKeyFor(rule, current, next);
    if (isBroaderChange(current, next)) {
      let preview: { count: number; capped: boolean } | null = null;
      try {
        preview = await fetchPreview(rule, next.months);
      } catch {
        // Without a count, the change still saves; the job is opt-in.
      }
      if (preview && preview.count > 0) {
        setPending({
          rule,
          turningOn: !current.enabled,
          months: next.months,
          count: preview.count,
          capped: preview.capped,
          columnName,
          apply: () => void save(patch, key),
        });
        return;
      }
    }
    await save(patch, key);
  };

  let body: React.ReactNode;
  if (isPending || !workspaceId) {
    body = (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  } else if (isError || !data) {
    body = (
      <div className="flex items-center gap-3 text-muted-foreground text-sm">
        <span>{t("settings:projectAutomations.loadError")}</span>
        <Button variant="outline" size="xs" onClick={() => refetch()}>
          {t("settings:projectAutomations.retry")}
        </Button>
      </div>
    );
  } else {
    const archive = data.autoArchive;
    const close = data.autoClose;
    const archiveSetting = { enabled: archive.enabled, months: archive.months };
    const closeSetting = { enabled: close.enabled, months: close.months };
    const validColumn = cancelled.find(
      (column) => column.id === close.columnId,
    );
    const defaultColumn = validColumn ?? cancelled[0];
    const noCancelledColumn = cancelled.length === 0;
    const paused = close.enabled && close.state === "paused";

    body = (
      <div className="space-y-3">
        <div className="space-y-4 rounded-md border border-border bg-card p-4">
          <AutomationRuleRow
            id="archive"
            icon={Archive}
            title={t("settings:projectAutomations.autoArchive.title")}
            description={t(
              "settings:projectAutomations.autoArchive.description",
            )}
            enabled={archive.enabled}
            disabled={!canEdit}
            onToggle={(enabled) =>
              void change({
                rule: "archive",
                current: archiveSetting,
                next: { ...archiveSetting, enabled },
                patch: { autoArchive: { enabled } },
              })
            }
          >
            <RuleSettings
              workspaceId={workspaceId}
              projectId={projectId}
              rule="archive"
              months={archive.months}
              disabled={!canEdit}
              lastRunAt={archive.lastArchivedAt}
              lastRunCount={archive.lastArchivedCount}
              onMonthsChange={(months) =>
                void change({
                  rule: "archive",
                  current: archiveSetting,
                  next: { ...archiveSetting, months },
                  patch: { autoArchive: { months } },
                })
              }
            />
          </AutomationRuleRow>
          <Separator />
          <AutomationRuleRow
            id="close"
            icon={CircleX}
            title={t("settings:projectAutomations.autoClose.title")}
            description={t("settings:projectAutomations.autoClose.description")}
            enabled={close.enabled}
            // Turning off stays possible; turning on needs a column.
            disabled={!canEdit || (noCancelledColumn && !close.enabled)}
            hint={
              noCancelledColumn
                ? t("settings:projectAutomations.autoClose.noCancelledColumn")
                : undefined
            }
            onToggle={(enabled) =>
              void change({
                rule: "close",
                current: closeSetting,
                next: { ...closeSetting, enabled },
                patch: {
                  autoClose:
                    enabled && defaultColumn
                      ? { enabled, columnId: defaultColumn.id }
                      : { enabled },
                },
                columnName: defaultColumn?.name,
              })
            }
          >
            <RuleSettings
              workspaceId={workspaceId}
              projectId={projectId}
              rule="close"
              months={close.months}
              disabled={!canEdit}
              lastRunAt={close.lastClosedAt}
              lastRunCount={close.lastClosedCount}
              onMonthsChange={(months) =>
                void change({
                  rule: "close",
                  current: closeSetting,
                  next: { ...closeSetting, months },
                  patch: { autoClose: { months } },
                  columnName: validColumn?.name,
                })
              }
              column={{
                value: validColumn?.id ?? null,
                options: cancelled,
                paused,
                onChange: (columnId) =>
                  void save(
                    { autoClose: { columnId } },
                    "settings:projectAutomations.toast.updated",
                  ),
              }}
            />
          </AutomationRuleRow>
        </div>
        {!canEdit && !isCheckingPermissions && (
          <p className="text-muted-foreground text-xs">
            {t("settings:projectAutomations.noPermission")}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      {body}
      <AutomationConfirmDialog
        pending={pending}
        onClose={() => setPending(null)}
      />
    </>
  );
}
