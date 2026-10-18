import { History, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type { AutomationRule } from "@/fetchers/automation-rule/automation-rules";
import {
  useCreateAutomationRule,
  useDeleteAutomationRule,
  useUpdateAutomationRule,
} from "@/hooks/mutations/automation-rule/use-automation-rule-mutations";
import { useAutomationRules } from "@/hooks/queries/automation-rule/use-automation-rules";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import AutomationRuleEditor from "./automation-rule-editor";
import AutomationRunHistory from "./automation-run-history";
import {
  draftComplete,
  draftToInput,
  emptyDraft,
  type RuleDraft,
  TEMPLATE_IDS,
  type TemplateId,
  templateDraft,
} from "./rule-model";
import { useRuleOptions } from "./use-rule-options";

// Settings → Projects → Workflow → Automations: the project's "When → If
// → Then" rules with on/off switches, the builder, starting templates and
// the run history. People without project:update see the list read-only.

const K = "settings:automationRules";

type Editing = { ruleId: string | null; draft: RuleDraft };

function toDraft(rule: AutomationRule): RuleDraft {
  return {
    name: rule.name,
    trigger: rule.trigger,
    conditions: rule.conditions,
    actions: rule.actions,
  };
}

function RuleRow({
  rule,
  canEdit,
  onEdit,
  onToggle,
  onDelete,
}: {
  rule: AutomationRule;
  canEdit: boolean;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const switchId = `automation-rule-${rule.id}`;
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <Zap className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <label
          htmlFor={switchId}
          className="block truncate font-medium text-sm"
        >
          {rule.name}
        </label>
        <p className="truncate text-muted-foreground text-xs">
          {t(`${K}.summary`, {
            trigger: t(`${K}.triggers.${rule.trigger.type}`),
            count: rule.actions.length,
          })}
          {" · "}
          {rule.lastRunAt
            ? t(`${K}.lastRun`, {
                count: rule.runCount,
                time: formatRelativeTime(
                  rule.lastRunAt,
                  i18n?.resolvedLanguage,
                ),
              })
            : t(`${K}.neverRan`)}
        </p>
      </div>
      {canEdit &&
        (confirming ? (
          <span className="flex items-center gap-1">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirming(false);
                onDelete();
              }}
            >
              {t(`${K}.confirmDelete`)}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              {t(`${K}.editor.cancel`)}
            </Button>
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t(`${K}.edit`, { name: rule.name })}
              onClick={onEdit}
            >
              <Pencil className="size-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t(`${K}.delete`, { name: rule.name })}
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </Button>
          </span>
        ))}
      <Switch
        id={switchId}
        checked={rule.enabled}
        disabled={!canEdit}
        onCheckedChange={canEdit ? onToggle : undefined}
      />
    </li>
  );
}

export default function AutomationRules({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { canUpdateProjects, isCheckingPermissions } = useWorkspacePermission();
  const canEdit = !isCheckingPermissions && canUpdateProjects();
  const { data, isLoading, isError } = useAutomationRules(projectId);
  const options = useRuleOptions(projectId);
  const create = useCreateAutomationRule(projectId);
  const update = useUpdateAutomationRule(projectId);
  const remove = useDeleteAutomationRule(projectId);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const saving = create.isPending || update.isPending;

  const startTemplate = (id: TemplateId) =>
    setEditing({
      ruleId: null,
      draft: templateDraft(id, {
        columns: options.columns,
        name: t(`${K}.templates.${id}.name`),
      }),
    });

  const save = async () => {
    if (!editing || !draftComplete(editing.draft)) return;
    try {
      const input = draftToInput(editing.draft);
      if (editing.ruleId) {
        await update.mutateAsync({ ruleId: editing.ruleId, patch: input });
      } else {
        await create.mutateAsync(input);
      }
      toast.success(t(`${K}.saved`));
      setEditing(null);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t(`${K}.saveError`),
      );
    }
  };

  const rules = data?.rules ?? [];

  return (
    <div className="space-y-4">
      {isLoading && <Spinner className="size-4" />}
      {isError && (
        <p className="text-destructive-foreground text-xs">
          {t(`${K}.loadError`)}
        </p>
      )}
      {!isLoading && !isError && rules.length === 0 && !editing && (
        <p className="text-muted-foreground text-sm">{t(`${K}.empty`)}</p>
      )}
      {rules.length > 0 && (
        <ul className="divide-y rounded-md border border-border bg-card">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              canEdit={canEdit}
              onEdit={() =>
                setEditing({ ruleId: rule.id, draft: toDraft(rule) })
              }
              onToggle={(enabled) =>
                update.mutate(
                  { ruleId: rule.id, patch: { enabled } },
                  { onError: () => toast.error(t(`${K}.saveError`)) },
                )
              }
              onDelete={() =>
                remove.mutate(rule.id, {
                  onSuccess: () => toast.success(t(`${K}.deleted`)),
                  onError: () => toast.error(t(`${K}.saveError`)),
                })
              }
            />
          ))}
        </ul>
      )}

      {editing ? (
        <div className="space-y-4 rounded-lg border border-border bg-muted/40 p-4">
          <AutomationRuleEditor
            draft={editing.draft}
            options={options}
            disabled={saving}
            onChange={(draft) => setEditing({ ...editing, draft })}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              {t(`${K}.editor.cancel`)}
            </Button>
            <Button
              size="sm"
              disabled={saving || !draftComplete(editing.draft)}
              onClick={() => void save()}
            >
              {saving && <Spinner className="size-3.5" />}
              {t(`${K}.editor.save`)}
            </Button>
          </div>
        </div>
      ) : (
        canEdit && (
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing({ ruleId: null, draft: emptyDraft() })}
            >
              <Plus className="size-3.5" aria-hidden />
              {t(`${K}.newRule`)}
            </Button>
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">
                {t(`${K}.templatesTitle`)}
              </p>
              <div className="flex flex-wrap gap-2">
                {TEMPLATE_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="rounded-md border bg-card px-3 py-2 text-start text-xs hover:bg-accent"
                    onClick={() => startTemplate(id)}
                  >
                    <span className="block font-medium text-sm">
                      {t(`${K}.templates.${id}.name`)}
                    </span>
                    <span className="block text-muted-foreground">
                      {t(`${K}.templates.${id}.description`)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )
      )}

      <div className="space-y-2">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={showHistory}
          onClick={() => setShowHistory((open) => !open)}
        >
          <History className="size-3.5" aria-hidden />
          {t(`${K}.history.title`)}
        </Button>
        {showHistory && <AutomationRunHistory projectId={projectId} />}
      </div>
    </div>
  );
}
