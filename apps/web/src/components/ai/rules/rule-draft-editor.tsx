import { Activity, Archive, CircleX, GitBranch, Redo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import AutomationRuleEditor from "@/components/project/automation-rules/automation-rule-editor";
import type { RuleDraft } from "@/components/project/automation-rules/rule-model";
import { useRuleOptions } from "@/components/project/automation-rules/use-rule-options";
import AutomationRuleRow from "@/components/project/scheduled-automations/automation-rule-row";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CompiledRule } from "@/fetchers/ai/rules";
import {
  AUTOMATION_MONTH_OPTIONS,
  DEFAULT_AUTOMATION_MONTHS,
} from "@/lib/automation";
import type { ProjectAutomations } from "@/types/project-automation";

// The compiled rule in the settings' own controls, editable before a dry
// run or save: a workflow rule as integration, event and column; a
// scheduled automation as the familiar switches, months and column.

export const RULE_INTEGRATIONS = ["github", "gitea"] as const;
export const RULE_EVENTS = [
  "branch_push",
  "pr_opened",
  "pr_merged",
  "issue_opened",
  "issue_closed",
] as const;

type WorkflowDraft = Extract<CompiledRule, { engine: "workflow_rule" }>;
type AutomationDraft = Extract<CompiledRule, { engine: "project_automation" }>;
type TaskRuleDraft = Extract<CompiledRule, { engine: "automation_rule" }>;
type Patch = AutomationDraft["patch"];

type ColumnOption = { id: string; name: string };

type RuleDraftEditorProps = {
  /** Needed for automation rules: their people, labels, cycles... */
  projectId?: string;
  draft: CompiledRule;
  columns: readonly ColumnOption[];
  cancelledColumns: readonly ColumnOption[];
  current?: ProjectAutomations;
  disabled?: boolean;
  onChange: (next: CompiledRule) => void;
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      {children}
    </div>
  );
}

function WorkflowEditor({
  draft,
  columns,
  disabled,
  onChange,
}: {
  draft: WorkflowDraft;
  columns: readonly ColumnOption[];
  disabled?: boolean;
  onChange: (next: WorkflowDraft) => void;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<WorkflowDraft["rule"]>) =>
    onChange({ ...draft, rule: { ...draft.rule, ...patch } });
  const column = columns.find((entry) => entry.id === draft.rule.columnId);

  return (
    <div className="space-y-2 rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <GitBranch aria-hidden className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">
          {t("ai:rules.workflowRule")}
        </span>
      </div>
      <Field label={t("ai:rules.integration")}>
        <Select
          value={draft.rule.integrationType}
          disabled={disabled}
          onValueChange={(value) => {
            if (value === "github" || value === "gitea") {
              set({ integrationType: value });
            }
          }}
        >
          <SelectTrigger
            className="h-8 w-48 text-sm"
            aria-label={t("ai:rules.integration")}
          >
            <SelectValue>
              {t(
                draft.rule.integrationType === "github"
                  ? "settings:workflowEditor.githubHeading"
                  : "settings:workflowEditor.giteaHeading",
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="github">
              {t("settings:workflowEditor.githubHeading")}
            </SelectItem>
            <SelectItem value="gitea">
              {t("settings:workflowEditor.giteaHeading")}
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label={t("ai:rules.when")}>
        <Select
          value={draft.rule.eventType}
          disabled={disabled}
          onValueChange={(value) => {
            const event = RULE_EVENTS.find((entry) => entry === value);
            if (event) set({ eventType: event });
          }}
        >
          <SelectTrigger
            className="h-8 w-48 text-sm"
            aria-label={t("ai:rules.when")}
          >
            <SelectValue>
              {t(`settings:workflowEditor.events.${draft.rule.eventType}`)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {RULE_EVENTS.map((event) => (
              <SelectItem key={event} value={event}>
                {t(`settings:workflowEditor.events.${event}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t("ai:rules.moveTo")}>
        <Select
          value={draft.rule.columnId}
          disabled={disabled}
          onValueChange={(value) => {
            if (typeof value === "string" && value) set({ columnId: value });
          }}
        >
          <SelectTrigger
            className="h-8 w-48 text-sm"
            aria-label={t("ai:rules.moveTo")}
          >
            <SelectValue>
              {column?.name ??
                t("settings:workflowEditor.selectColumnPlaceholder")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {columns.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

function MonthsSelect({
  months,
  disabled,
  label,
  onChange,
}: {
  months: number;
  disabled?: boolean;
  label: string;
  onChange: (months: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Field label={label}>
      <Select
        value={String(months)}
        disabled={disabled}
        onValueChange={(value) => {
          const next = Number(value);
          if (Number.isInteger(next)) onChange(next);
        }}
      >
        <SelectTrigger className="h-8 w-40 text-sm" aria-label={label}>
          <SelectValue>
            {t("settings:projectAutomations.months", { count: months })}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {AUTOMATION_MONTH_OPTIONS.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {t("settings:projectAutomations.months", { count: option })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function AutomationEditor({
  draft,
  cancelledColumns,
  current,
  disabled,
  onChange,
}: {
  draft: AutomationDraft;
  cancelledColumns: readonly ColumnOption[];
  current?: ProjectAutomations;
  disabled?: boolean;
  onChange: (next: AutomationDraft) => void;
}) {
  const { t } = useTranslation();
  const { patch } = draft;
  const set = (next: Patch) => onChange({ ...draft, patch: next });
  const isDisabled = Boolean(disabled);

  const archiveOn =
    patch.autoArchive?.enabled ?? current?.autoArchive.enabled ?? false;
  const archiveMonths =
    patch.autoArchive?.months ??
    current?.autoArchive.months ??
    DEFAULT_AUTOMATION_MONTHS;
  const closeOn =
    patch.autoClose?.enabled ?? current?.autoClose.enabled ?? false;
  const closeMonths =
    patch.autoClose?.months ??
    current?.autoClose.months ??
    DEFAULT_AUTOMATION_MONTHS;
  const closeColumnId =
    patch.autoClose?.columnId !== undefined
      ? patch.autoClose.columnId
      : (current?.autoClose.columnId ?? null);
  const closeColumn = cancelledColumns.find(
    (column) => column.id === closeColumnId,
  );

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-3">
      {patch.autoArchive && (
        <AutomationRuleRow
          id="ai-draft-archive"
          icon={Archive}
          title={t("settings:projectAutomations.autoArchive.title")}
          description={t("settings:projectAutomations.autoArchive.description")}
          enabled={archiveOn}
          disabled={isDisabled}
          onToggle={(enabled) =>
            set({ ...patch, autoArchive: { ...patch.autoArchive, enabled } })
          }
        >
          <MonthsSelect
            months={archiveMonths}
            disabled={disabled}
            label={t("settings:projectAutomations.autoArchive.after")}
            onChange={(months) =>
              set({ ...patch, autoArchive: { ...patch.autoArchive, months } })
            }
          />
        </AutomationRuleRow>
      )}
      {patch.autoClose && (
        <AutomationRuleRow
          id="ai-draft-close"
          icon={CircleX}
          title={t("settings:projectAutomations.autoClose.title")}
          description={t("settings:projectAutomations.autoClose.description")}
          enabled={closeOn}
          disabled={isDisabled}
          hint={
            cancelledColumns.length === 0
              ? t("settings:projectAutomations.autoClose.noCancelledColumn")
              : undefined
          }
          onToggle={(enabled) =>
            set({
              ...patch,
              autoClose: {
                ...patch.autoClose,
                enabled,
                ...(enabled && !closeColumn && cancelledColumns[0]
                  ? { columnId: cancelledColumns[0].id }
                  : {}),
              },
            })
          }
        >
          <MonthsSelect
            months={closeMonths}
            disabled={disabled}
            label={t("settings:projectAutomations.autoClose.after")}
            onChange={(months) =>
              set({ ...patch, autoClose: { ...patch.autoClose, months } })
            }
          />
          <Field label={t("settings:projectAutomations.autoClose.target")}>
            <Select
              value={closeColumnId ?? ""}
              disabled={disabled}
              onValueChange={(value) => {
                if (typeof value === "string" && value) {
                  set({
                    ...patch,
                    autoClose: { ...patch.autoClose, columnId: value },
                  });
                }
              }}
            >
              <SelectTrigger
                className="h-8 w-40 text-sm"
                aria-label={t("settings:projectAutomations.autoClose.target")}
              >
                <SelectValue>{closeColumn?.name ?? "—"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {cancelledColumns.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </AutomationRuleRow>
      )}
      {patch.cycleRollover && (
        <AutomationRuleRow
          id="ai-draft-rollover"
          icon={Redo2}
          title={t("settings:projectAutomations.cycleRollover.title")}
          description={t(
            "settings:projectAutomations.cycleRollover.description",
          )}
          enabled={patch.cycleRollover.enabled ?? false}
          disabled={isDisabled}
          onToggle={(enabled) => set({ ...patch, cycleRollover: { enabled } })}
        />
      )}
      {patch.flowAlerts && (
        <AutomationRuleRow
          id="ai-draft-flow"
          icon={Activity}
          title={t("settings:projectAutomations.flowAlerts.title")}
          description={t("settings:projectAutomations.flowAlerts.description")}
          enabled={patch.flowAlerts.enabled ?? false}
          disabled={isDisabled}
          onToggle={(enabled) => set({ ...patch, flowAlerts: { enabled } })}
        />
      )}
    </div>
  );
}

/** A compiled automation rule in the Automations builder. */
function TaskRuleEditor({
  projectId,
  draft,
  disabled,
  onChange,
}: {
  projectId: string;
  draft: TaskRuleDraft;
  disabled?: boolean;
  onChange: (next: TaskRuleDraft) => void;
}) {
  const options = useRuleOptions(projectId);
  const rule: RuleDraft = {
    name: draft.rule.name,
    trigger: draft.rule.trigger,
    conditions: draft.rule.conditions ?? null,
    actions: draft.rule.actions,
  };
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <AutomationRuleEditor
        draft={rule}
        options={options}
        disabled={disabled}
        onChange={(next) =>
          onChange({
            ...draft,
            rule: next as unknown as TaskRuleDraft["rule"],
          })
        }
      />
    </div>
  );
}

/** One compiled rule, editable in the settings' usual controls. */
export default function RuleDraftEditor({
  projectId = "",
  draft,
  columns,
  cancelledColumns,
  current,
  disabled,
  onChange,
}: RuleDraftEditorProps) {
  if (draft.engine === "automation_rule") {
    return (
      <TaskRuleEditor
        projectId={projectId}
        draft={draft}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }
  if (draft.engine === "workflow_rule") {
    return (
      <WorkflowEditor
        draft={draft}
        columns={columns}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }
  return (
    <AutomationEditor
      draft={draft}
      cancelledColumns={cancelledColumns}
      current={current}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
