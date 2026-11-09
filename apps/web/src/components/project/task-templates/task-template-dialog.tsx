import { Check, Search, Tag, UserIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import AssigneeAvatarStack from "@/components/task/assignee-avatar-stack";
import AssigneeMultiSelect from "@/components/task/assignee-multi-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { useCreateTaskTemplate } from "@/hooks/mutations/task-template/use-create-task-template";
import { useUpdateTaskTemplate } from "@/hooks/mutations/task-template/use-update-task-template";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { useActiveEstimate } from "@/hooks/queries/estimate/use-active-estimate";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import { useAssigneePeople } from "@/hooks/use-task-assignees";
import { cn } from "@/lib/cn";
import { withoutTriage } from "@/lib/column-groups";
import { formatEstimateValue } from "@/lib/estimate/format";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import { formatAssigneeSummary, resolveAssignees } from "@/lib/task-assignees";
import {
  EMPTY_TEMPLATE_FORM,
  formToTemplateBody,
  type TemplateFormValues,
  templateToForm,
} from "@/lib/task-template";
import { toast } from "@/lib/toast";
import type { TaskTemplate } from "@/types/task-template";
import SubtaskChecklistEditor from "./subtask-checklist-editor";

// "" stands for null in the selects: base-ui items need string values.
const NONE = "";

const PRIORITY_VALUES = ["low", "medium", "high", "urgent"] as const;

type TaskTemplateDialogProps = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  projectId: string;
  /** Edit this template; without it the dialog creates one. */
  template?: TaskTemplate | null;
};

/** Create or edit a task template: every field a new task can start with. */
export default function TaskTemplateDialog({
  open,
  onClose,
  workspaceId,
  projectId,
  template,
}: TaskTemplateDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {template
              ? t("templates:form.editTitle")
              : t("templates:form.createTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("templates:form.description")}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <TemplateForm
            // A fresh form per template, so a reopened dialog never shows
            // the previous one's edits.
            key={template?.id ?? "new"}
            workspaceId={workspaceId}
            projectId={projectId}
            template={template ?? null}
            onDone={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TemplateForm({
  workspaceId,
  projectId,
  template,
  onDone,
}: {
  workspaceId: string;
  projectId: string;
  template: TaskTemplate | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [form, setForm] = useState<TemplateFormValues>(() =>
    template ? templateToForm(template) : EMPTY_TEMPLATE_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync: create, isPending: creating } = useCreateTaskTemplate();
  const { mutateAsync: update, isPending: updating } = useUpdateTaskTemplate();
  const saving = creating || updating;

  const { data: columns } = useGetColumns(projectId);
  const statusOptions = useMemo(() => withoutTriage(columns ?? []), [columns]);
  const { estimate } = useActiveEstimate({ projectId, workspaceId });
  const points = useMemo(
    () => [...(estimate?.points ?? [])].sort((a, b) => a.position - b.position),
    [estimate],
  );

  const set = <K extends keyof TemplateFormValues>(
    key: K,
    value: TemplateFormValues[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || saving) return;
    setError(null);
    const body = formToTemplateBody(form);
    // A point of a system that is no longer active can't be saved again.
    if (!estimate) body.estimatePointId = null;
    try {
      if (template) {
        await update({ workspaceId, projectId, id: template.id, patch: body });
        toast.success(t("templates:settings.toast.updated"));
      } else {
        await create({ workspaceId, input: { projectId, ...body } });
        toast.success(t("templates:settings.toast.created"));
      }
      onDone();
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : t("templates:settings.toast.error"),
      );
    }
  };

  const selectedColumn = statusOptions.find(
    (column) => column.id === form.columnId,
  );
  const selectedPoint = points.find(
    (point) => point.id === form.estimatePointId,
  );

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col">
      <DialogPanel className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>{t("templates:form.name")}</Label>
          <Input
            id={`${id}-name`}
            value={form.name}
            maxLength={80}
            required
            autoFocus
            placeholder={t("templates:form.namePlaceholder")}
            onChange={(event) => set("name", event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-pattern`}>
            {t("templates:form.titlePattern")}
          </Label>
          <Input
            id={`${id}-pattern`}
            value={form.titlePattern}
            maxLength={200}
            placeholder={t("templates:form.titlePatternPlaceholder")}
            aria-describedby={`${id}-pattern-hint`}
            onChange={(event) => set("titlePattern", event.target.value)}
          />
          <p
            id={`${id}-pattern-hint`}
            className="text-muted-foreground text-xs"
          >
            {t("templates:form.titlePatternHint")}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-description`}>
            {t("templates:form.taskDescription")}
          </Label>
          <Textarea
            id={`${id}-description`}
            value={form.description}
            maxLength={100_000}
            rows={4}
            placeholder={t("templates:form.taskDescriptionPlaceholder")}
            onChange={(event) => set("description", event.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label id={`${id}-status`}>{t("templates:form.status")}</Label>
            <Select
              value={form.columnId ?? NONE}
              onValueChange={(value) =>
                set("columnId", (value as string) || null)
              }
            >
              <SelectTrigger aria-labelledby={`${id}-status`}>
                <SelectValue>
                  {selectedColumn?.name ?? t("templates:form.statusDefault")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  {t("templates:form.statusDefault")}
                </SelectItem>
                {statusOptions.map((column) => (
                  <SelectItem key={column.id} value={column.id}>
                    {column.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label id={`${id}-priority`}>{t("templates:form.priority")}</Label>
            <Select
              value={form.priority ?? NONE}
              onValueChange={(value) =>
                set("priority", (value as string) || null)
              }
            >
              <SelectTrigger aria-labelledby={`${id}-priority`}>
                <SelectValue>
                  <span className="flex items-center gap-1.5">
                    {form.priority && getPriorityIcon(form.priority)}
                    {form.priority
                      ? t(`tasks:priority.${form.priority as "low"}`)
                      : t("templates:form.notSet")}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  {t("templates:form.notSet")}
                </SelectItem>
                {PRIORITY_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    <span className="flex items-center gap-1.5">
                      {getPriorityIcon(value)}
                      {t(`tasks:priority.${value}`)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label id={`${id}-assignees`}>
              {t("templates:form.assignees")}
            </Label>
            <AssigneePicker
              labelledBy={`${id}-assignees`}
              workspaceId={workspaceId}
              selectedIds={form.assigneeIds}
              onChange={(ids) => set("assigneeIds", ids)}
            />
          </div>

          <div className="space-y-1.5">
            <Label id={`${id}-labels`}>{t("templates:form.labels")}</Label>
            <LabelPicker
              labelledBy={`${id}-labels`}
              workspaceId={workspaceId}
              selectedIds={form.labelIds}
              onChange={(ids) => set("labelIds", ids)}
            />
          </div>

          {estimate && (
            <div className="space-y-1.5">
              <Label id={`${id}-estimate`}>
                {t("templates:form.estimate")}
              </Label>
              <Select
                value={selectedPoint?.id ?? NONE}
                onValueChange={(value) =>
                  set("estimatePointId", (value as string) || null)
                }
              >
                <SelectTrigger aria-labelledby={`${id}-estimate`}>
                  <SelectValue>
                    {selectedPoint
                      ? formatEstimateValue(
                          estimate.type,
                          selectedPoint.value,
                          {
                            withUnit: true,
                            t,
                          },
                        )
                      : t("tasks:estimate.none")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {t("tasks:estimate.none")}
                  </SelectItem>
                  {points.map((point) => (
                    <SelectItem key={point.id} value={point.id}>
                      {formatEstimateValue(estimate.type, point.value, {
                        withUnit: true,
                        t,
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <SubtaskChecklistEditor
          items={form.subtasks}
          onChange={(subtasks) => set("subtasks", subtasks)}
        />

        {error && (
          <p role="alert" className="text-destructive-foreground text-sm">
            {error}
          </p>
        )}
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!form.name.trim() || saving}
          data-loading={saving || undefined}
        >
          {template ? t("templates:form.save") : t("templates:form.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}

const pickerTriggerClass =
  "flex h-9 w-full items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8";

function AssigneePicker({
  labelledBy,
  workspaceId,
  selectedIds,
  onChange,
}: {
  labelledBy: string;
  workspaceId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const { people, audience } = useAssigneePeople(workspaceId);
  const selected = resolveAssignees(selectedIds, people, [], { audience });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-labelledby={labelledBy}
          className={pickerTriggerClass}
        >
          {selected.length > 0 ? (
            <>
              <AssigneeAvatarStack assignees={selected} max={3} size="xs" />
              <span className="min-w-0 truncate">
                {formatAssigneeSummary(selected, t)}
              </span>
            </>
          ) : (
            <>
              <UserIcon
                aria-hidden
                className="size-3.5 text-muted-foreground"
              />
              <span className="truncate text-muted-foreground">
                {t("templates:form.assigneesNone")}
              </span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <AssigneeMultiSelect
          workspaceId={workspaceId}
          selectedIds={selectedIds}
          onToggle={(userId, nextChecked) =>
            onChange(
              nextChecked
                ? [...selectedIds.filter((id) => id !== userId), userId]
                : selectedIds.filter((id) => id !== userId),
            )
          }
          onClear={() => onChange([])}
        />
      </PopoverContent>
    </Popover>
  );
}

function LabelPicker({
  labelledBy,
  workspaceId,
  selectedIds,
  onChange,
}: {
  labelledBy: string;
  workspaceId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const { data: allLabels = [] } = useGetLabelsByWorkspace(workspaceId);
  // Templates hold workspace labels; task copies can't be referenced.
  const labels = useMemo(
    () => allLabels.filter((label) => label.taskId === null),
    [allLabels],
  );
  const selected = labels.filter((label) => selectedIds.includes(label.id));
  const query = search.trim().toLowerCase();
  const shown = query
    ? labels.filter((label) => label.name.toLowerCase().includes(query))
    : labels;

  const toggle = (labelId: string) =>
    onChange(
      selectedIds.includes(labelId)
        ? selectedIds.filter((id) => id !== labelId)
        : [...selectedIds, labelId],
    );

  return (
    <Popover onOpenChange={(open) => !open && setSearch("")}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-labelledby={labelledBy}
          className={pickerTriggerClass}
        >
          {selected.length > 0 ? (
            <span className="flex min-w-0 items-center gap-1.5 truncate">
              {selected.map((label) => (
                <span
                  key={label.id}
                  className="inline-flex min-w-0 items-center gap-1"
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: resolveLabelColor(label.color) }}
                  />
                  <span className="truncate">{label.name}</span>
                </span>
              ))}
            </span>
          ) : (
            <>
              <Tag aria-hidden className="size-3.5 text-muted-foreground" />
              <span className="truncate text-muted-foreground">
                {t("templates:form.labelsNone")}
              </span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <div className="flex items-center gap-2 border-border border-b px-2 py-1.5">
          <Search aria-hidden className="size-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("templates:form.labelsSearch")}
            aria-label={t("templates:form.labelsSearch")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {shown.length === 0 ? (
            <p className="px-2 py-1.5 text-muted-foreground text-xs">
              {t("templates:form.labelsEmpty")}
            </p>
          ) : (
            shown.map((label) => {
              const checked = selectedIds.includes(label.id);
              return (
                <button
                  key={label.id}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => toggle(label.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent/50",
                    checked && "text-foreground",
                  )}
                >
                  <span className="flex w-3.5 shrink-0 justify-center">
                    {checked && <Check aria-hidden className="size-3.5" />}
                  </span>
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: resolveLabelColor(label.color) }}
                  />
                  <span className="truncate">{label.name}</span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
