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
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
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

type CaptureBarProps = {
  projectId: string;
  workspaceId: string;
  /** The column slug new tasks land in. */
  status: string;
  /** The column's display name, for the label and the preview line. */
  statusName: string;
  className?: string;
};

const EMPTY_MEMBERS: CaptureMember[] = [];

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
  status,
  statusName,
  className,
}: CaptureBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set());
  const [focused, setFocused] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
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

  const candidates = captureAssignees(
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
    : parsed.assigneeIds;

  // `C`, the shell's Create button and the list's group menus focus a bar.
  const request = useCaptureFocus((state) => state.request);
  const handledRequest = useRef(useCaptureFocus.getState().request?.id);
  useEffect(() => {
    if (!request || request.id === handledRequest.current) return;
    if (request.projectId !== projectId || request.status !== status) return;
    handledRequest.current = request.id;
    const input = inputRef.current;
    if (!input) return;
    input.scrollIntoView?.({ block: "nearest" });
    input.focus();
  }, [request, projectId, status]);

  const reset = () => {
    setText("");
    setIgnored(new Set());
    setDefaultDismissed(false);
  };

  const submit = async () => {
    const { title, priority, dueDate } = parsed;
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
        priority: priority ?? "no-priority",
        dueDate: dueDate ? dueDateToIso(dueDate) : undefined,
      });
      for (const label of parsed.labels) {
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

  const openComposer = () => setComposerOpen(true);

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
      else inputRef.current?.blur();
    }
  };

  const active = focused || text.length > 0;

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
          aria-label={t("tasks:capture.ariaLabel", { column: statusName })}
          aria-describedby={active ? `capture-hint-${status}` : undefined}
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
          id={`capture-hint-${status}`}
          className="flex flex-wrap items-center gap-1 border-border/60 border-t px-2 py-1.5"
        >
          {parsed.tokens.length > 0 || defaultAssignee ? (
            <>
              <span className="me-0.5 text-muted-foreground text-xs">
                {t("tasks:capture.preview", { column: statusName })}
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
          prefill={{
            title: parsed.title,
            priority: parsed.priority ?? undefined,
            assigneeIds,
            dueDate: parsed.dueDate ? parseISO(parsed.dueDate) : undefined,
            labels: parsed.labels,
          }}
          onClose={() => {
            setComposerOpen(false);
            reset();
          }}
        />
      )}
    </div>
  );
}
