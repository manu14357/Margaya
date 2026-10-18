import { useNavigate } from "@tanstack/react-router";
import { parseISO } from "date-fns";
import {
  AtSign,
  CalendarDays,
  CornerDownLeft,
  Maximize2,
  Plus,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import CaptureTemplateButton from "@/components/project/task-templates/capture-template-button";
import CreateTaskModal, {
  type CreateTaskPrefill,
} from "@/components/shared/modals/create-task-modal";
import useCreateLabel from "@/hooks/mutations/label/use-create-label";
import useCreateTask from "@/hooks/mutations/task/use-create-task";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import useProjectPeople from "@/hooks/queries/project/use-project-people";
import { useAssigneePeople } from "@/hooks/use-task-assignees";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { captureAssignees } from "@/lib/default-assignee";
import { formatDateMedium } from "@/lib/format";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import { runCreateModalSlots } from "@/lib/task-property-slots";
import { toast } from "@/lib/toast";
import {
  type CaptureLabel,
  type CaptureMember,
  type CaptureToken,
  dueDateToIso,
  parseCapture,
} from "./capture-parser";
import useCaptureFocus from "./capture-store";
import DefaultAssigneeChip from "./default-assignee-chip";

/**
 * What a new task starts with: its column, plus the value of the group the
 * bar sits in, so the task shows up where it was typed. Typed tokens win
 * over the group's priority and due date and add to its assignee and label.
 */
export type CapturePrefill = {
  /** The column slug new tasks land in. */
  status: string;
  /** Where the task lands (a column or group), for the label and preview. */
  targetName: string;
  priority?: string;
  /** The group's assignees; an empty list skips the project default. */
  assigneeIds?: readonly string[];
  labels?: readonly CaptureLabel[];
  /** Applied after the create (needs cycle:update). */
  cycleId?: string;
  /** Applied after the create (needs module:update). */
  moduleId?: string;
  /** Applied after the create (needs task:update). */
  estimatePointId?: string;
  /** YYYY-MM-DD: a calendar day. */
  dueDate?: string;
};

type CaptureBarProps = {
  projectId: string;
  workspaceId: string;
  className?: string;
  /** The input's accessible name, when "Add task to {target}" doesn't fit. */
  inputLabel?: string;
  /** Focus on mount (a bar opened from a "+" trigger). */
  autoFocus?: boolean;
  /** After the task and its group values are saved. */
  onCreated?: (task: { id: string; projectId: string }) => void;
  /** Ctrl Enter hands off here instead of opening the composer in place. */
  onOpenComposer?: (handoff: {
    status: string;
    prefill: CreateTaskPrefill;
  }) => void;
  /** Escape on an empty bar; without it the bar only blurs. */
  onDismiss?: () => void;
} & (
  | {
      /** The column slug new tasks land in. */
      status: string;
      /** The column's display name, for the label and the preview line. */
      statusName: string;
      prefill?: undefined;
    }
  | { prefill: CapturePrefill; status?: undefined; statusName?: undefined }
);

const EMPTY_MEMBERS: CaptureMember[] = [];

const PRIORITIES = ["no-priority", "low", "medium", "high", "urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

/** A group's priority key as the create body's priority. */
function asPriority(value: string | undefined): Priority {
  return PRIORITIES.find((priority) => priority === value) ?? "no-priority";
}

function mergeLabels(
  typed: readonly CaptureLabel[],
  group: readonly CaptureLabel[] | undefined,
): CaptureLabel[] {
  const merged = [...typed];
  for (const label of group ?? []) {
    const name = label.name.toLowerCase();
    if (!merged.some((entry) => entry.name.toLowerCase() === name)) {
      merged.push({ name: label.name, color: label.color });
    }
  }
  return merged;
}

function TokenChip({
  token,
  onRemove,
}: {
  token: CaptureToken;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  let icon: React.ReactNode = null;
  let text = token.raw;
  if (token.kind === "assignee") {
    icon = <AtSign className="size-3 text-muted-foreground" />;
    text = token.member.name;
  } else if (token.kind === "label") {
    icon = (
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: resolveLabelColor(token.color) }}
      />
    );
    text = token.isNew
      ? t("tasks:capture.newLabel", { name: token.name })
      : token.name;
  } else if (token.kind === "priority") {
    icon = getPriorityIcon(token.priority);
    text = getPriorityLabel(token.priority);
  } else {
    icon = <CalendarDays className="size-3 text-muted-foreground" />;
    text = t("tasks:capture.due", {
      date: formatDateMedium(parseISO(token.date)),
    });
  }

  return (
    <span
      data-token={token.kind}
      className={cn(
        "inline-flex h-5 max-w-48 items-center gap-1 rounded-full border bg-background ps-1.5 pe-0.5 text-foreground text-xs",
        token.kind === "label" && token.isNew
          ? "border-border border-dashed"
          : "border-border",
      )}
    >
      {icon}
      <span className="truncate">{text}</span>
      <button
        type="button"
        className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={t("tasks:capture.removeToken", { token: token.raw })}
        // Keeps focus in the input.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/**
 * The one-line capture bar (DESIGN-SYSTEM §7.3): type a title with `@person`,
 * `#label`, `!priority` and date words; each match shows as a removable chip
 * and the rest stays the title. Enter creates and keeps the bar ready for the
 * next task, Ctrl Enter opens the full composer, Escape clears or leaves.
 */
export default function CaptureBar({
  projectId,
  workspaceId,
  status: statusProp,
  statusName,
  prefill,
  className,
  inputLabel,
  autoFocus = false,
  onCreated,
  onOpenComposer,
  onDismiss,
}: CaptureBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hintId = useId();
  const target: CapturePrefill = prefill ?? {
    status: statusProp ?? "",
    targetName: statusName ?? "",
  };
  const { status } = target;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set());
  const [focused, setFocused] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [pending, setPending] = useState(0);
  // The project's default assignee applies until removed for this entry.
  const [defaultDismissed, setDefaultDismissed] = useState(false);
  const { defaultAssigneeUserId } = useProjectPeople(workspaceId, projectId);
  const { people } = useAssigneePeople(workspaceId);
  const { data: workspaceLabels } = useGetLabelsByWorkspace(workspaceId);
  const { canCreateLabels } = useWorkspacePermission();
  const allowNewLabels = canCreateLabels();
  const { mutateAsync: createTask } = useCreateTask();
  const { mutateAsync: createLabel } = useCreateLabel();

  const labels = useMemo<CaptureLabel[]>(() => {
    const byName = new Map<string, CaptureLabel>();
    for (const label of workspaceLabels ?? []) {
      if (!byName.has(label.name.toLowerCase())) {
        byName.set(label.name.toLowerCase(), {
          name: label.name,
          color: label.color,
        });
      }
    }
    return [...byName.values()];
  }, [workspaceLabels]);

  const parsed = useMemo(
    () =>
      parseCapture(text, {
        members: people ?? EMPTY_MEMBERS,
        labels,
        allowNewLabels,
        today: new Date(),
        ignored,
      }),
    [text, people, labels, allowNewLabels, ignored],
  );

  // A group's assignee replaces the project default.
  const candidates = target.assigneeIds
    ? []
    : captureAssignees(
        parsed.assigneeIds,
        defaultAssigneeUserId,
        defaultDismissed,
      );
  // The default shows as a removable chip; it applies only while visible.
  const defaultAssignee =
    parsed.assigneeIds.length === 0 && candidates.length > 0
      ? people?.find((person) => person.id === candidates[0])
      : undefined;
  const assigneeIds = defaultAssignee
    ? [defaultAssignee.id]
    : [...new Set([...(target.assigneeIds ?? []), ...parsed.assigneeIds])];
  const labelsToAdd = mergeLabels(parsed.labels, target.labels);
  const priorityToSet = parsed.priority ?? target.priority;
  const dueDay = parsed.dueDate ?? target.dueDate;

  // `C`, the shell's Create button and the list's group menus focus a bar.
  // Group bars (with a prefill) are not column bars, so they don't answer.
  const answersFocusRequests = !prefill;
  const request = useCaptureFocus((state) => state.request);
  const handledRequest = useRef(useCaptureFocus.getState().request?.id);
  useEffect(() => {
    if (!answersFocusRequests) return;
    if (!request || request.id === handledRequest.current) return;
    if (request.projectId !== projectId || request.status !== status) return;
    handledRequest.current = request.id;
    const input = inputRef.current;
    if (!input) return;
    input.scrollIntoView?.({ block: "nearest" });
    input.focus();
  }, [answersFocusRequests, request, projectId, status]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only on mount
  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.scrollIntoView?.({ block: "nearest" });
    inputRef.current?.focus();
  }, []);

  const reset = () => {
    setText("");
    setIgnored(new Set());
    setDefaultDismissed(false);
  };

  const submit = async () => {
    const { title } = parsed;
    if (!title) return;
    const typed = text;
    const typedIgnored = ignored;
    const typedDismissed = defaultDismissed;
    // Clear at once so the next task can be typed while this one saves.
    reset();
    setPending((count) => count + 1);
    try {
      const task = await createTask({
        title,
        description: "",
        projectId,
        status,
        assigneeIds,
        priority: asPriority(priorityToSet),
        dueDate: dueDay ? dueDateToIso(dueDay) : undefined,
      });
      // The group's cycle, module and estimate go through the same steps as
      // the composer's pickers; each says so itself when it fails.
      const groupValues: Record<string, unknown> = {
        ...(target.cycleId ? { cycle: target.cycleId } : {}),
        ...(target.moduleId ? { module: [target.moduleId] } : {}),
        ...(target.estimatePointId ? { estimate: target.estimatePointId } : {}),
      };
      if (Object.keys(groupValues).length > 0) {
        await runCreateModalSlots({
          task: { id: task.id, projectId },
          values: groupValues,
        });
      }
      for (const label of labelsToAdd) {
        try {
          await createLabel({
            name: label.name,
            color: label.color,
            taskId: task.id,
            workspaceId,
          });
        } catch {
          toast.error(t("tasks:capture.labelError", { name: label.name }));
        }
      }
      onCreated?.({ id: task.id, projectId });
      toast.success(t("common:modals.createTask.successCreated"), {
        action: {
          label: t("tasks:capture.open"),
          onClick: () => navigate({ to: ".", search: { taskId: task.id } }),
        },
      });
    } catch (error) {
      // Give the text back unless something new was typed meanwhile.
      if (!inputRef.current?.value) {
        setText(typed);
        setIgnored(typedIgnored);
        setDefaultDismissed(typedDismissed);
      }
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("common:modals.createTask.createError"),
      );
    } finally {
      setPending((count) => count - 1);
    }
  };

  const composerPrefill: CreateTaskPrefill = {
    title: parsed.title,
    priority: priorityToSet,
    assigneeIds,
    dueDate: dueDay ? parseISO(dueDay) : undefined,
    labels: labelsToAdd,
  };

  const openComposer = () => {
    if (onOpenComposer) {
      onOpenComposer({ status, prefill: composerPrefill });
      reset();
      return;
    }
    setComposerOpen(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      // The composer's own Ctrl Enter submits from the document; stopping the
      // event here keeps it from reaching a listener that mounts mid-event.
      if (event.ctrlKey || event.metaKey) {
        event.stopPropagation();
        openComposer();
      } else void submit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (text) reset();
      else if (onDismiss) onDismiss();
      else inputRef.current?.blur();
    }
  };

  // An open template menu holds focus outside the input; the bar stays open.
  const active = focused || text.length > 0 || templateMenuOpen;
  // A template sets its own values, so it is offered only where the column
  // alone decides where the task shows up (not in a day or person group).
  const offersTemplates =
    target.priority === undefined &&
    target.assigneeIds === undefined &&
    target.labels === undefined &&
    !target.cycleId &&
    !target.moduleId &&
    !target.estimatePointId &&
    !target.dueDate;

  const createdFromTemplate = (task: { id: string; projectId: string }) => {
    reset();
    inputRef.current?.focus();
    onCreated?.(task);
    toast.success(t("common:modals.createTask.successCreated"), {
      action: {
        label: t("tasks:capture.open"),
        onClick: () => navigate({ to: ".", search: { taskId: task.id } }),
      },
    });
  };

  return (
    <div
      data-capture-bar
      className={cn(
        "rounded-md border transition-[background-color,border-color,box-shadow] duration-150",
        active
          ? "border-border bg-card shadow-sm"
          : "border-transparent hover:bg-accent/60",
        className,
      )}
    >
      <div className="flex h-8 items-center gap-1.5 ps-2 pe-1">
        <Plus
          aria-hidden
          className={cn(
            "size-3.5 shrink-0",
            active ? "text-foreground" : "text-muted-foreground",
          )}
        />
        <input
          ref={inputRef}
          type="text"
          value={text}
          maxLength={500}
          data-capture-input={status}
          aria-label={
            inputLabel ??
            t("tasks:capture.ariaLabel", { column: target.targetName })
          }
          aria-describedby={active ? hintId : undefined}
          placeholder={t("tasks:capture.placeholder")}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoComplete="off"
          spellCheck={false}
        />
        {active && (
          <>
            {offersTemplates && (
              <CaptureTemplateButton
                projectId={projectId}
                workspaceId={workspaceId}
                status={status}
                title={parsed.title}
                onCreated={createdFromTemplate}
                onOpenChange={setTemplateMenuOpen}
              />
            )}
            <button
              type="button"
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t("tasks:capture.openComposer")}
              title={t("tasks:capture.openComposerHint")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={openComposer}
            >
              <Maximize2 className="size-3.5" />
            </button>
            <button
              type="button"
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label={t("tasks:capture.create")}
              disabled={!parsed.title}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void submit()}
            >
              <CornerDownLeft className="size-3.5" />
            </button>
          </>
        )}
      </div>
      {active && (
        <div
          id={hintId}
          className="flex flex-wrap items-center gap-1 border-border/60 border-t px-2 py-1.5"
        >
          {parsed.tokens.length > 0 || defaultAssignee ? (
            <>
              <span className="me-0.5 text-muted-foreground text-xs">
                {t("tasks:capture.preview", { column: target.targetName })}
              </span>
              {defaultAssignee && (
                <DefaultAssigneeChip
                  name={defaultAssignee.name}
                  onRemove={() => setDefaultDismissed(true)}
                />
              )}
              {parsed.tokens.map((token) => (
                <TokenChip
                  key={token.key}
                  token={token}
                  onRemove={() =>
                    setIgnored((previous) => new Set(previous).add(token.key))
                  }
                />
              ))}
            </>
          ) : (
            <span className="text-muted-foreground text-xs">
              {t("tasks:capture.hint")}
            </span>
          )}
          {pending > 0 && (
            <span
              role="status"
              className="ms-auto text-muted-foreground text-xs"
            >
              {t("tasks:capture.saving")}
            </span>
          )}
        </div>
      )}

      {composerOpen && (
        <CreateTaskModal
          open
          projectId={projectId}
          status={status}
          prefill={composerPrefill}
          onClose={() => {
            setComposerOpen(false);
            reset();
          }}
        />
      )}
    </div>
  );
}
