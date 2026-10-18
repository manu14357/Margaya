import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationConditions,
  AutomationTrigger,
} from "@/fetchers/automation-rule/automation-rules";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { LabelInput, MultiPicker, SinglePicker } from "./pickers";
import {
  ACTION_TYPES,
  type ActionType,
  CONDITION_FIELDS,
  type ConditionField,
  emptyAction,
  emptyCondition,
  emptyTrigger,
  NOTIFY_ROLES,
  OPS_OF,
  PRIORITIES,
  type RuleDraft,
  TEMPLATE_VARIABLES,
  TRIGGER_TYPES,
  type TriggerType,
} from "./rule-model";
import type { Option, RuleOptions } from "./use-rule-options";

// The "When → If → Then" builder: one trigger row, condition rows (all or
// any, with one level of nested groups) and action rows. Plain controls on
// a card; no colour beyond the app's neutral surfaces.

const K = "settings:automationRules";

type GroupItem = AutomationConditions["conditions"][number];

function Step({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[4.5rem_1fr]">
      <span className="pt-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </span>
      <div className="min-w-0 space-y-2">{children}</div>
    </div>
  );
}

function Row({
  children,
  onRemove,
  removeLabel,
  disabled,
}: {
  children: ReactNode;
  onRemove?: () => void;
  removeLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-2 py-1.5">
      {children}
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ms-auto size-7"
          aria-label={removeLabel}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      )}
    </div>
  );
}

function useLists(options: RuleOptions) {
  const { t } = useTranslation();
  const priorities: Option[] = PRIORITIES.map((priority) => ({
    id: priority,
    name: getPriorityLabel(priority),
  }));
  const labels: Option[] = options.labels.map((name) => ({ id: name, name }));
  const columns = options.columns.filter((column) => column.group !== "triage");
  const roles: Option[] = NOTIFY_ROLES.map((role) => ({
    id: role,
    name: t(`${K}.roles.${role}`),
  }));
  return { priorities, labels, columns, roles };
}

function TriggerRow({
  trigger,
  options,
  disabled,
  onChange,
}: {
  trigger: AutomationTrigger;
  options: RuleOptions;
  disabled?: boolean;
  onChange: (trigger: AutomationTrigger) => void;
}) {
  const { t } = useTranslation();
  const { priorities, labels, columns } = useLists(options);
  const any = t(`${K}.editor.any`);
  const types: Option[] = TRIGGER_TYPES.map((type) => ({
    id: type,
    name: t(`${K}.triggers.${type}`),
  }));
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...trigger, ...patch } as AutomationTrigger);

  return (
    <Row removeLabel="" disabled={disabled}>
      <SinglePicker
        value={trigger.type}
        options={types}
        label={t(`${K}.editor.when`)}
        disabled={disabled}
        className="h-8 w-56 text-sm"
        onChange={(type) => onChange(emptyTrigger(type as TriggerType))}
      />
      {trigger.type === "status_changed" && (
        <>
          <span className="text-muted-foreground text-xs">
            {t(`${K}.editor.from`)}
          </span>
          <MultiPicker
            values={trigger.from ?? []}
            options={columns}
            label={t(`${K}.editor.from`)}
            emptyLabel={any}
            disabled={disabled}
            onChange={(from) => set({ from })}
          />
          <span className="text-muted-foreground text-xs">
            {t(`${K}.editor.to`)}
          </span>
          <MultiPicker
            values={trigger.to ?? []}
            options={columns}
            label={t(`${K}.editor.to`)}
            emptyLabel={any}
            disabled={disabled}
            onChange={(to) => set({ to })}
          />
        </>
      )}
      {trigger.type === "task_created" && (
        <span className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={Boolean(trigger.fromIntake)}
            aria-label={t(`${K}.editor.fromIntake`)}
            disabled={disabled}
            onCheckedChange={(checked) =>
              set({ fromIntake: checked === true ? true : undefined })
            }
          />
          <span aria-hidden>{t(`${K}.editor.fromIntake`)}</span>
        </span>
      )}
      {(trigger.type === "assignee_added" ||
        trigger.type === "assignee_removed") && (
        <MultiPicker
          values={trigger.userIds ?? []}
          options={options.people}
          label={t(`${K}.editor.people`)}
          emptyLabel={any}
          disabled={disabled}
          onChange={(userIds) => set({ userIds })}
        />
      )}
      {(trigger.type === "label_added" || trigger.type === "label_removed") && (
        <MultiPicker
          values={trigger.labels ?? []}
          options={labels}
          label={t(`${K}.editor.labels`)}
          emptyLabel={any}
          disabled={disabled}
          onChange={(values) => set({ labels: values })}
        />
      )}
      {trigger.type === "priority_changed" && (
        <MultiPicker
          values={trigger.to ?? []}
          options={priorities}
          label={t(`${K}.editor.priorities`)}
          emptyLabel={any}
          disabled={disabled}
          onChange={(to) => set({ to })}
        />
      )}
      {trigger.type === "moved_to_cycle" && (
        <MultiPicker
          values={trigger.cycleIds ?? []}
          options={options.cycles}
          label={t(`${K}.editor.cycles`)}
          emptyLabel={any}
          disabled={disabled}
          onChange={(cycleIds) => set({ cycleIds })}
        />
      )}
      {trigger.type === "moved_to_module" && (
        <MultiPicker
          values={trigger.moduleIds ?? []}
          options={options.modules}
          label={t(`${K}.editor.modules`)}
          emptyLabel={any}
          disabled={disabled}
          onChange={(moduleIds) => set({ moduleIds })}
        />
      )}
    </Row>
  );
}

function ConditionRow({
  condition,
  options,
  disabled,
  onChange,
  onRemove,
}: {
  condition: AutomationCondition;
  options: RuleOptions;
  disabled?: boolean;
  onChange: (condition: AutomationCondition) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { priorities, labels, columns } = useLists(options);
  const fields: Option[] = CONDITION_FIELDS.map((field) => ({
    id: field,
    name: t(`${K}.conditions.${field}`),
  }));
  const ops: Option[] = OPS_OF[condition.field].map((op) => ({
    id: op,
    name: t(`${K}.ops.${op}`),
  }));
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...condition, ...patch } as AutomationCondition);

  return (
    <Row
      removeLabel={t(`${K}.editor.remove`)}
      disabled={disabled}
      onRemove={onRemove}
    >
      <SinglePicker
        value={condition.field}
        options={fields}
        label={t(`${K}.editor.field`)}
        disabled={disabled}
        className="h-8 w-36 text-sm"
        onChange={(field) => onChange(emptyCondition(field as ConditionField))}
      />
      {condition.field === "custom_field" && (
        <SinglePicker
          value={condition.fieldId}
          options={options.fields}
          label={t(`${K}.conditions.custom_field`)}
          disabled={disabled}
          className="h-8 w-36 text-sm"
          onChange={(fieldId) => set({ fieldId })}
        />
      )}
      <SinglePicker
        value={condition.op}
        options={ops}
        label={t(`${K}.editor.operator`)}
        disabled={disabled}
        className="h-8 w-36 text-sm"
        onChange={(op) => set({ op })}
      />
      {condition.field === "status" && (
        <MultiPicker
          values={condition.columnIds}
          options={columns}
          label={t(`${K}.conditions.status`)}
          disabled={disabled}
          onChange={(columnIds) => set({ columnIds })}
        />
      )}
      {condition.field === "labels" && (
        <MultiPicker
          values={condition.labels}
          options={labels}
          label={t(`${K}.conditions.labels`)}
          disabled={disabled}
          onChange={(values) => set({ labels: values })}
        />
      )}
      {condition.field === "priority" && (
        <MultiPicker
          values={condition.values}
          options={priorities}
          label={t(`${K}.conditions.priority`)}
          disabled={disabled}
          onChange={(values) => set({ values })}
        />
      )}
      {condition.field === "assignee" &&
        (condition.op === "is" || condition.op === "is_not") && (
          <MultiPicker
            values={condition.userIds ?? []}
            options={options.people}
            label={t(`${K}.conditions.assignee`)}
            disabled={disabled}
            onChange={(userIds) => set({ userIds })}
          />
        )}
      {condition.field === "estimate" &&
        (condition.op === "gte" || condition.op === "lte") && (
          <Input
            type="number"
            min={0}
            value={condition.value ?? ""}
            disabled={disabled}
            aria-label={t(`${K}.editor.points`)}
            className="h-8 w-24 text-sm"
            onChange={(event) =>
              set({
                value:
                  event.target.value === ""
                    ? undefined
                    : Number(event.target.value),
              })
            }
          />
        )}
      {(condition.field === "title" || condition.field === "custom_field") && (
        <Input
          value={condition.value}
          maxLength={condition.field === "title" ? 200 : 500}
          disabled={disabled}
          aria-label={t(`${K}.editor.value`)}
          className="h-8 w-44 text-sm"
          onChange={(event) => set({ value: event.target.value })}
        />
      )}
    </Row>
  );
}

function ActionRow({
  action,
  options,
  disabled,
  onChange,
  onRemove,
}: {
  action: AutomationAction;
  options: RuleOptions;
  disabled?: boolean;
  onChange: (action: AutomationAction) => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const { priorities, columns, roles } = useLists(options);
  const types: Option[] = ACTION_TYPES.map((type) => ({
    id: type,
    name: t(`${K}.actions.${type}`),
  }));
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...action, ...patch } as AutomationAction);
  const variables = (
    <span className="w-full text-muted-foreground text-xs">
      {t(`${K}.editor.variables`)}{" "}
      {TEMPLATE_VARIABLES.map((name) => (
        <code key={name} className="me-1 rounded bg-muted px-1 font-mono">
          {`{{${name}}}`}
        </code>
      ))}
    </span>
  );

  return (
    <Row
      removeLabel={t(`${K}.editor.remove`)}
      disabled={disabled}
      onRemove={onRemove}
    >
      <SinglePicker
        value={action.type}
        options={types}
        label={t(`${K}.editor.then`)}
        disabled={disabled}
        className="h-8 w-48 text-sm"
        onChange={(type) => onChange(emptyAction(type as ActionType))}
      />
      {action.type === "set_status" && (
        <SinglePicker
          value={action.columnId}
          options={columns}
          label={t(`${K}.editor.column`)}
          disabled={disabled}
          onChange={(columnId) => set({ columnId })}
        />
      )}
      {(action.type === "assign" || action.type === "unassign") && (
        <MultiPicker
          values={action.userIds}
          options={options.people}
          label={t(`${K}.editor.people`)}
          emptyLabel={
            action.type === "unassign" ? t(`${K}.editor.everyone`) : undefined
          }
          disabled={disabled}
          onChange={(userIds) => set({ userIds })}
        />
      )}
      {(action.type === "add_label" || action.type === "remove_label") && (
        <LabelInput
          value={action.label}
          labels={options.labels}
          label={t(`${K}.editor.label`)}
          disabled={disabled}
          onChange={(label) => set({ label })}
        />
      )}
      {action.type === "set_priority" && (
        <SinglePicker
          value={action.priority}
          options={priorities}
          label={t(`${K}.editor.priority`)}
          disabled={disabled}
          onChange={(priority) => set({ priority })}
        />
      )}
      {action.type === "set_due_date" && (
        <span className="flex items-center gap-2 text-xs">
          <Input
            type="number"
            min={0}
            max={365}
            value={action.offsetDays}
            aria-label={t(`${K}.editor.daysFromRun`)}
            disabled={disabled}
            className="h-8 w-20 text-sm"
            onChange={(event) =>
              set({
                offsetDays: Math.max(
                  0,
                  Math.min(365, Math.trunc(Number(event.target.value) || 0)),
                ),
              })
            }
          />
          <span aria-hidden>{t(`${K}.editor.daysFromRun`)}</span>
        </span>
      )}
      {action.type === "add_comment" && (
        <>
          <Textarea
            value={action.template}
            maxLength={2000}
            disabled={disabled}
            aria-label={t(`${K}.editor.comment`)}
            className="min-h-16 w-full text-sm"
            onChange={(event) => set({ template: event.target.value })}
          />
          {variables}
        </>
      )}
      {action.type === "create_subtask" && (
        <>
          <Input
            value={action.title}
            maxLength={200}
            disabled={disabled}
            aria-label={t(`${K}.editor.subtaskTitle`)}
            className="h-8 w-72 text-sm"
            onChange={(event) => set({ title: event.target.value })}
          />
          {variables}
        </>
      )}
      {action.type === "move_to_cycle" && (
        <SinglePicker
          value={action.cycleId}
          options={options.cycles}
          label={t(`${K}.editor.cycle`)}
          disabled={disabled}
          onChange={(cycleId) => set({ cycleId })}
        />
      )}
      {action.type === "move_to_module" && (
        <SinglePicker
          value={action.moduleId}
          options={options.modules}
          label={t(`${K}.editor.module`)}
          disabled={disabled}
          onChange={(moduleId) => set({ moduleId })}
        />
      )}
      {action.type === "run_agent" && (
        <>
          <SinglePicker
            value={action.agentId}
            options={options.agents ?? []}
            label={t(`${K}.editor.agent`)}
            disabled={disabled}
            onChange={(agentId) => set({ agentId })}
          />
          <Textarea
            value={action.prompt}
            maxLength={2000}
            disabled={disabled}
            aria-label={t(`${K}.editor.agentPrompt`)}
            placeholder={t(`${K}.editor.agentPromptPlaceholder`)}
            className="min-h-16 w-full text-sm"
            onChange={(event) => set({ prompt: event.target.value })}
          />
          {variables}
          <span className="w-full text-muted-foreground text-xs">
            {t(`${K}.editor.agentHint`)}
          </span>
        </>
      )}
      {action.type === "notify" && (
        <>
          <MultiPicker
            values={action.roles ?? []}
            options={roles}
            label={t(`${K}.editor.roles`)}
            disabled={disabled}
            onChange={(values) =>
              set({ roles: values as (typeof NOTIFY_ROLES)[number][] })
            }
          />
          <MultiPicker
            values={action.userIds ?? []}
            options={options.people}
            label={t(`${K}.editor.people`)}
            disabled={disabled}
            onChange={(userIds) => set({ userIds })}
          />
          <Input
            value={action.message ?? ""}
            maxLength={500}
            disabled={disabled}
            placeholder={t(`${K}.editor.message`)}
            aria-label={t(`${K}.editor.message`)}
            className="h-8 w-full text-sm"
            onChange={(event) =>
              set({ message: event.target.value || undefined })
            }
          />
        </>
      )}
    </Row>
  );
}

function ConditionGroup({
  group,
  options,
  disabled,
  nested,
  onChange,
}: {
  group: AutomationConditions;
  options: RuleOptions;
  disabled?: boolean;
  nested?: boolean;
  onChange: (group: AutomationConditions | null) => void;
}) {
  const { t } = useTranslation();
  const ops: Option[] = [
    { id: "and", name: t(`${K}.editor.matchAll`) },
    { id: "or", name: t(`${K}.editor.matchAny`) },
  ];
  const items = group.conditions;
  const replace = (index: number, item: GroupItem | null) => {
    const next = items.flatMap((entry, at) =>
      at === index ? (item ? [item] : []) : [entry],
    );
    onChange(next.length > 0 ? { ...group, conditions: next } : null);
  };
  const add = (item: GroupItem) =>
    onChange({ ...group, conditions: [...items, item] });

  return (
    <div
      className={
        nested ? "space-y-2 rounded-md border border-dashed p-2" : "space-y-2"
      }
    >
      <SinglePicker
        value={group.op}
        options={ops}
        label={t(`${K}.editor.match`)}
        disabled={disabled}
        className="h-8 w-48 text-sm"
        onChange={(op) => onChange({ ...group, op: op as "and" | "or" })}
      />
      {items.map((item, index) =>
        "field" in item ? (
          <ConditionRow
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no ids
            key={index}
            condition={item as AutomationCondition}
            options={options}
            disabled={disabled}
            onChange={(condition) => replace(index, condition)}
            onRemove={() => replace(index, null)}
          />
        ) : (
          <ConditionGroup
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no ids
            key={index}
            group={item as AutomationConditions}
            options={options}
            disabled={disabled}
            nested
            onChange={(next) => replace(index, next as GroupItem | null)}
          />
        ),
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || items.length >= 20}
          onClick={() => add(emptyCondition("labels"))}
        >
          <Plus className="size-3.5" aria-hidden />
          {t(`${K}.editor.addCondition`)}
        </Button>
        {!nested && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || items.length >= 20}
            onClick={() =>
              add({
                op: group.op === "and" ? "or" : "and",
                conditions: [emptyCondition("priority")],
              } as GroupItem)
            }
          >
            <Plus className="size-3.5" aria-hidden />
            {t(`${K}.editor.addGroup`)}
          </Button>
        )}
      </div>
    </div>
  );
}

export default function AutomationRuleEditor({
  draft,
  options,
  disabled,
  onChange,
}: {
  draft: RuleDraft;
  options: RuleOptions;
  disabled?: boolean;
  onChange: (draft: RuleDraft) => void;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<RuleDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className="space-y-4">
      <Input
        value={draft.name}
        maxLength={120}
        disabled={disabled}
        placeholder={t(`${K}.editor.namePlaceholder`)}
        aria-label={t(`${K}.editor.name`)}
        className="h-9 text-sm"
        onChange={(event) => set({ name: event.target.value })}
      />
      <Step label={t(`${K}.editor.when`)}>
        <TriggerRow
          trigger={draft.trigger}
          options={options}
          disabled={disabled}
          onChange={(trigger) => set({ trigger })}
        />
      </Step>
      <Step label={t(`${K}.editor.if`)}>
        {draft.conditions ? (
          <ConditionGroup
            group={draft.conditions}
            options={options}
            disabled={disabled}
            onChange={(conditions) => set({ conditions })}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {t(`${K}.editor.always`)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() =>
                set({
                  conditions: {
                    op: "and",
                    conditions: [emptyCondition("labels")],
                  },
                })
              }
            >
              <Plus className="size-3.5" aria-hidden />
              {t(`${K}.editor.addCondition`)}
            </Button>
          </div>
        )}
      </Step>
      <Step label={t(`${K}.editor.then`)}>
        {draft.actions.map((action, index) => (
          <ActionRow
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no ids
            key={index}
            action={action}
            options={options}
            disabled={disabled}
            onChange={(next) =>
              set({
                actions: draft.actions.map((entry, at) =>
                  at === index ? next : entry,
                ),
              })
            }
            onRemove={
              draft.actions.length > 1
                ? () =>
                    set({
                      actions: draft.actions.filter((_, at) => at !== index),
                    })
                : undefined
            }
          />
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || draft.actions.length >= 10}
          onClick={() =>
            set({ actions: [...draft.actions, emptyAction("add_comment")] })
          }
        >
          <Plus className="size-3.5" aria-hidden />
          {t(`${K}.editor.addAction`)}
        </Button>
      </Step>
    </div>
  );
}
