import {
  AlertTriangle,
  BookOpen,
  Bot,
  Boxes,
  Check,
  ChevronRight,
  CircleDot,
  FilePlus,
  FileText,
  FolderKanban,
  FolderPlus,
  Link2,
  ListPlus,
  type LucideIcon,
  MessageSquare,
  MessageSquarePlus,
  PackagePlus,
  Pencil,
  RefreshCw,
  Repeat,
  Sparkles,
  SquareCheck,
  Tag,
  Trash2,
  Undo2,
  UserPlus,
  X,
} from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type {
  BuildAction,
  BuildActionOp,
  BuildActionResult,
  BuildPlanContext,
} from "@/fetchers/ai/chat-build";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { AskThinking } from "../ask/ask-turn";
import { AgentRunCard } from "./agent-run-card";
import type { BuildTurn as BuildTurnState } from "./use-build-session";

const OP_ICONS: Record<BuildActionOp, LucideIcon> = {
  create_project: FolderPlus,
  create_task: ListPlus,
  update_task: Pencil,
  set_status: CircleDot,
  assign: UserPlus,
  add_comment: MessageSquarePlus,
  create_cycle: Repeat,
  add_to_cycle: RefreshCw,
  create_module: Boxes,
  add_to_module: PackagePlus,
  create_page: FilePlus,
  link_tasks: Link2,
  create_label: Tag,
  delete_task: Trash2,
  run_agent: Bot,
};

const PRIORITIES = ["no-priority", "low", "medium", "high", "urgent"] as const;

const selectClass =
  "h-7.5 min-w-0 rounded-lg border border-input bg-background px-2 text-foreground text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 dark:bg-input/32";

type Member = { id: string; name: string };
type Params = Record<string, unknown>;

/** Whether applying would attempt the action. */
export function willApply(
  action: BuildAction,
  confirmed: readonly string[],
): boolean {
  if (action.problem) return false;
  return action.risk !== "destructive" || confirmed.includes(action.id);
}

/** The action with one param set (undefined or "" removes it). */
function withParam(action: BuildAction, key: string, value: unknown) {
  const params: Params = { ...(action.params as Params) };
  if (value === undefined || value === "") delete params[key];
  else params[key] = value;
  return { ...action, params } as BuildAction;
}

/** Replaces an unresolved value (a name) with the picked candidate's id. */
export function pickCandidate(action: BuildAction, id: string): BuildAction {
  const problem = action.problem;
  if (!problem?.field) return action;
  const params: Params = { ...(action.params as Params) };
  const current = params[problem.field];
  params[problem.field] = Array.isArray(current)
    ? [
        ...new Set(
          current.map((value) => (value === problem.value ? id : value)),
        ),
      ]
    : id;
  return { ...action, params, problem: null } as BuildAction;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child.
    <label className="flex min-w-0 flex-col gap-1 text-muted-foreground text-xs">
      <span>{label}</span>
      {children}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  maxLength = 255,
}: {
  label: string;
  value: unknown;
  onChange: (value: string) => void;
  type?: "text" | "date";
  maxLength?: number;
}) {
  return (
    <Field label={label}>
      <Input
        size="sm"
        type={type}
        maxLength={maxLength}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** The simple fields of a card that can be edited before confirming. */
function ActionFields({
  action,
  members,
  onChange,
}: {
  action: BuildAction;
  members: readonly Member[];
  onChange: (next: BuildAction) => void;
}) {
  const { t } = useTranslation();
  const params = action.params as Params;
  const set = (key: string) => (value: unknown) =>
    onChange(withParam(action, key, value));
  const assignee = (key: string, list: boolean) =>
    members.length > 0 && (
      <Field label={t("ai:build.chat.fields.assignee")}>
        <select
          className={selectClass}
          value={
            list
              ? ((Array.isArray(params[key])
                  ? (params[key] as string[])
                  : [])[0] ?? "")
              : ""
          }
          onChange={(event) =>
            set(key)(event.target.value ? [event.target.value] : undefined)
          }
        >
          <option value="">{t("ai:build.chat.fields.unassigned")}</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </Field>
    );

  switch (action.op) {
    case "create_project":
      return (
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <TextField
            label={t("ai:build.chat.fields.name")}
            value={params.name}
            onChange={set("name")}
            maxLength={120}
          />
          <TextField
            label={t("ai:build.chat.fields.key")}
            value={params.key}
            onChange={(value) => set("key")(value.toUpperCase())}
            maxLength={8}
          />
        </div>
      );
    case "create_task":
      return (
        <div className="flex flex-col gap-2">
          <TextField
            label={t("ai:build.chat.fields.title")}
            value={params.title}
            onChange={set("title")}
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Field label={t("ai:build.chat.fields.priority")}>
              <select
                className={selectClass}
                value={
                  typeof params.priority === "string"
                    ? params.priority
                    : "no-priority"
                }
                onChange={(event) => set("priority")(event.target.value)}
              >
                {PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {getPriorityLabel(priority)}
                  </option>
                ))}
              </select>
            </Field>
            <TextField
              type="date"
              label={t("ai:build.chat.fields.dueDate")}
              value={params.dueDate}
              onChange={set("dueDate")}
            />
            {assignee("assigneeIds", true)}
          </div>
        </div>
      );
    case "assign":
      return assignee("userIds", true) || null;
    case "add_comment":
      return (
        <Field label={t("ai:build.chat.fields.content")}>
          <Textarea
            size="sm"
            maxLength={10_000}
            value={typeof params.content === "string" ? params.content : ""}
            onChange={(event) => set("content")(event.target.value)}
          />
        </Field>
      );
    case "create_cycle":
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <TextField
            label={t("ai:build.chat.fields.name")}
            value={params.name}
            onChange={set("name")}
          />
          <TextField
            type="date"
            label={t("ai:build.chat.fields.startDate")}
            value={params.startDate}
            onChange={set("startDate")}
          />
          <TextField
            type="date"
            label={t("ai:build.chat.fields.endDate")}
            value={params.endDate}
            onChange={set("endDate")}
          />
        </div>
      );
    case "create_module":
    case "create_label":
      return (
        <TextField
          label={t("ai:build.chat.fields.name")}
          value={params.name}
          onChange={set("name")}
          maxLength={action.op === "create_label" ? 40 : 255}
        />
      );
    case "create_page":
      return (
        <TextField
          label={t("ai:build.chat.fields.title")}
          value={params.title}
          onChange={set("title")}
        />
      );
    default:
      return null;
  }
}

function ResultLine({
  result,
  undoState,
  onOpen,
  onUndo,
}: {
  result: BuildActionResult;
  undoState: "pending" | "done" | "error" | undefined;
  onOpen?: (url: string) => void;
  onUndo: () => void;
}) {
  const { t } = useTranslation();
  if (!result.ok) {
    return (
      <p
        role="alert"
        className="flex items-start gap-1.5 text-destructive-foreground text-xs"
      >
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          {result.skipped
            ? t("ai:build.chat.skipped")
            : t("ai:build.chat.failed")}
          {result.error ? `: ${result.error}` : ""}
        </span>
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="inline-flex items-center gap-1 text-foreground">
        <Check className="size-3.5 text-primary" aria-hidden />
        <span className="sr-only">{t("ai:build.chat.done")}</span>
      </span>
      {result.url && onOpen ? (
        <button
          type="button"
          className="min-w-0 truncate rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => onOpen(result.url as string)}
        >
          {result.label ?? t("ai:build.chat.open")}
        </button>
      ) : (
        result.label && <span className="min-w-0 truncate">{result.label}</span>
      )}
      {result.error && (
        <span className="text-muted-foreground">{result.error}</span>
      )}
      {result.undoToken &&
        (undoState === "done" ? (
          <span className="text-muted-foreground">
            {t("ai:build.chat.undone")}
          </span>
        ) : (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="ms-auto text-muted-foreground"
            disabled={undoState === "pending"}
            onClick={onUndo}
          >
            <Undo2 aria-hidden />
            {t("ai:build.chat.undo")}
          </Button>
        ))}
      {undoState === "error" && (
        <span role="alert" className="text-destructive-foreground">
          {t("ai:build.chat.undoFailed")}
        </span>
      )}
    </div>
  );
}

function ActionCard({
  action,
  turn,
  workspaceId,
  members,
  editable,
  onChange,
  onRemove,
  onToggleDestructive,
  onUndo,
  onOpen,
}: {
  action: BuildAction;
  turn: BuildTurnState;
  workspaceId: string;
  members: readonly Member[];
  editable: boolean;
  onChange: (next: BuildAction) => void;
  onRemove: () => void;
  onToggleDestructive: () => void;
  onUndo: () => void;
  onOpen?: (url: string) => void;
}) {
  const { t } = useTranslation();
  const tickId = useId();
  const Icon = OP_ICONS[action.op];
  const result = turn.results[action.id];
  const destructive = action.risk === "destructive";
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-background p-2.5",
        destructive && "border-destructive/40",
        action.problem && "border-dashed",
      )}
      aria-label={action.title}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
            destructive && "bg-destructive/10 text-destructive-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-muted-foreground text-xs">
            {t(`ai:build.chat.ops.${action.op}`)}
          </span>
          <span className="break-words font-medium text-sm">
            {action.title}
          </span>
          {action.detail && (
            <span className="break-words text-muted-foreground text-xs">
              {action.detail}
            </span>
          )}
        </div>
        {editable && (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={t("ai:build.chat.remove", { title: action.title })}
            onClick={onRemove}
          >
            <X aria-hidden />
          </Button>
        )}
      </div>

      {editable && !action.problem && (
        <ActionFields action={action} members={members} onChange={onChange} />
      )}

      {action.problem && !result && (
        <div className="flex flex-col gap-1.5 text-xs">
          <p className="flex items-start gap-1.5 text-destructive-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {t(`ai:build.chat.problems.${action.problem.code}`)}{" "}
              <span className="text-muted-foreground">
                {action.problem.message}
              </span>
            </span>
          </p>
          {editable &&
            action.problem.field &&
            (action.problem.candidates?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground">
                  {t("ai:build.chat.pickCandidate")}
                </span>
                {action.problem.candidates?.map((candidate) => (
                  <Button
                    key={candidate.id}
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      onChange(pickCandidate(action, candidate.id))
                    }
                  >
                    {candidate.name}
                  </Button>
                ))}
              </div>
            )}
        </div>
      )}

      {destructive && editable && !action.problem && (
        <label
          htmlFor={tickId}
          className="flex items-center gap-2 text-destructive-foreground text-xs"
        >
          <input
            id={tickId}
            type="checkbox"
            className="size-3.5 accent-current"
            checked={turn.confirmed.includes(action.id)}
            onChange={onToggleDestructive}
          />
          {t("ai:build.chat.confirmDestructive")}
        </label>
      )}

      {result && (
        <ResultLine
          result={result}
          undoState={turn.undo[action.id]}
          onOpen={onOpen}
          onUndo={onUndo}
        />
      )}
      {result?.ok && result.runId && (
        <AgentRunCard workspaceId={workspaceId} runId={result.runId} />
      )}
    </li>
  );
}

export type BuildTurnProps = {
  turn: BuildTurnState;
  workspaceId: string;
  onConfirm: () => void;
  onCancel: () => void;
  onUndo: (actionId: string) => void;
  onEdit?: (actionId: string, next: BuildAction) => void;
  onRemove?: (actionId: string) => void;
  onToggleDestructive?: (actionId: string) => void;
  /** A clarifying question's option was picked. */
  onAnswer?: (option: string) => void;
  /** In-app navigation to a created or changed item. */
  onOpen?: (url: string) => void;
};

const CONTEXT_ICONS: Record<string, LucideIcon> = {
  task: SquareCheck,
  comment: MessageSquare,
  page: FileText,
  project: FolderKanban,
};

/**
 * What the plan was made from: the workspace facts it saw, the items it
 * read in full (linked), memory notes and earlier messages. Open while the
 * plan is made, folded once it is in; a click overrides either way.
 */
function BuildContextView({
  context,
  live,
  onOpen,
}: {
  context: BuildPlanContext;
  live: boolean;
  onOpen?: (url: string) => void;
}) {
  const { t } = useTranslation();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? live;
  // Several comments on one task read as one row with a count.
  const items = useMemo(() => {
    const grouped = new Map<
      string,
      BuildPlanContext["items"][number] & { count: number }
    >();
    for (const item of context.items) {
      const key = `${item.kind}|${item.title}|${item.url}`;
      const seen = grouped.get(key);
      if (seen) seen.count += 1;
      else grouped.set(key, { ...item, count: 1 });
    }
    return [...grouped.entries()];
  }, [context.items]);
  const rows =
    1 +
    items.length +
    (context.memoryNotes > 0 ? 1 : 0) +
    (context.earlierTurns > 0 ? 1 : 0);
  return (
    <div className="text-xs" data-testid="build-context">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
        className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BookOpen aria-hidden className="size-3.5 shrink-0" />
        {t("ai:build.context.title", { count: rows })}
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-1 border-s-2 ps-2.5 text-muted-foreground">
          <li>{t("ai:build.context.facts", context.facts)}</li>
          {items.map(([key, item]) => {
            const Icon = CONTEXT_ICONS[item.kind] ?? FileText;
            const title =
              item.count > 1 ? `${item.title} ×${item.count}` : item.title;
            return (
              <li key={key} className="flex min-w-0 items-center gap-1.5">
                <Icon aria-hidden className="size-3 shrink-0" />
                {onOpen && item.url ? (
                  <button
                    type="button"
                    onClick={() => onOpen(item.url)}
                    className="min-w-0 cursor-pointer truncate text-start hover:text-foreground hover:underline"
                  >
                    {title}
                  </button>
                ) : (
                  <span className="min-w-0 truncate">{title}</span>
                )}
              </li>
            );
          })}
          {context.memoryNotes > 0 && (
            <li>
              {t("ai:build.context.memory", { count: context.memoryNotes })}
            </li>
          )}
          {context.earlierTurns > 0 && (
            <li>
              {t("ai:build.context.history", { count: context.earlierTurns })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** The small round mark beside the AI's replies (as in Ask). */
function BuildAvatar() {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted text-foreground"
    >
      <Sparkles className="size-3.5" />
    </span>
  );
}

/**
 * One Build exchange: the request, what the plan read and how it thought,
 * the plan's summary and its action cards (editable until confirmed), the
 * confirm footer, and the results with links and Undo.
 */
export function BuildTurn({
  turn,
  workspaceId,
  onConfirm,
  onCancel,
  onUndo,
  onEdit,
  onRemove,
  onToggleDestructive,
  onAnswer,
  onOpen,
}: BuildTurnProps) {
  const { t } = useTranslation();
  const { data: users } = useGetActiveWorkspaceUsers(workspaceId);
  const members = useMemo<Member[]>(
    () =>
      (users?.members ?? []).map((member) => ({
        id: member.userId,
        name: member.user?.name ?? member.user?.email ?? "",
      })),
    [users],
  );
  const editable = turn.status === "ready";
  const ready = turn.actions.filter((action) =>
    willApply(action, turn.confirmed),
  ).length;
  const resultList = Object.values(turn.results);
  const applied = resultList.filter((result) => result.ok).length;
  const planning = turn.status === "planning";
  const applying = turn.status === "applying";

  return (
    <>
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-muted px-3.5 py-2 text-sm">
          <span className="sr-only">{t("ai:ask.you")}: </span>
          {turn.prompt}
        </p>
      </div>
      <div className="flex gap-3">
        <BuildAvatar />
        <section
          aria-live="polite"
          aria-busy={planning || applying}
          aria-label={t("ai:build.chat.planLabel")}
          className="flex min-w-0 flex-1 flex-col gap-2"
        >
          {turn.context && (
            <BuildContextView
              context={turn.context}
              live={planning}
              onOpen={onOpen}
            />
          )}
          <AskThinking
            thinkingSince={planning ? turn.startedAt : null}
            reasoning={turn.reasoning}
            reasoningMs={turn.reasoningMs}
          />
          {turn.summary && <p className="text-sm">{turn.summary}</p>}
          {turn.plan === "nothing" && !turn.summary && (
            <p className="text-muted-foreground text-sm">
              {t("ai:build.chat.nothing")}
            </p>
          )}
          {turn.autopilot?.applied && (
            <p className="text-muted-foreground text-xs">
              {t("ai:build.chat.autopilotApplied")}
            </p>
          )}
          {turn.autopilot && !turn.autopilot.applied && (
            <p className="text-muted-foreground text-xs">
              {turn.autopilot.reason === "AUTOPILOT_OFF"
                ? t("ai:build.chat.autopilotOff")
                : t("ai:build.chat.autopilotReview")}
            </p>
          )}

          {turn.question && (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-2.5">
              <p className="text-sm">{turn.question.text}</p>
              {turn.question.options.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {turn.question.options.map((option) => (
                    <Button
                      key={option}
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={!onAnswer}
                      onClick={() => onAnswer?.(option)}
                    >
                      {option}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}

          {turn.actions.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {turn.actions.map((action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  turn={turn}
                  workspaceId={workspaceId}
                  members={members}
                  editable={editable}
                  onChange={(next) => onEdit?.(action.id, next)}
                  onRemove={() => onRemove?.(action.id)}
                  onToggleDestructive={() => onToggleDestructive?.(action.id)}
                  onUndo={() => onUndo(action.id)}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          )}
          {turn.truncated && (
            <p className="text-muted-foreground text-xs">
              {t("ai:build.chat.truncated")}
            </p>
          )}

          {(turn.status === "ready" || turn.status === "applying") &&
            turn.actions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5">
                <p className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">
                    {t("ai:build.chat.awaiting")}
                  </span>
                  <span aria-hidden className="text-muted-foreground">
                    {" · "}
                  </span>
                  {applying ? (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Spinner aria-hidden className="size-3.5" />
                      <span className="ask-shimmer">
                        {t("ai:build.chat.applying")}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {turn.actions.every((action) => action.problem)
                        ? t("ai:build.chat.noneReady")
                        : t("ai:build.chat.ready", { count: ready })}
                    </span>
                  )}
                </p>
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={turn.status === "applying"}
                    onClick={onCancel}
                  >
                    {t("ai:build.chat.cancel")}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    disabled={ready === 0 || turn.status === "applying"}
                    onClick={onConfirm}
                  >
                    {t("ai:build.chat.confirm")}
                  </Button>
                </div>
              </div>
            )}

          {turn.status === "applied" && resultList.length > 0 && (
            <p className="text-muted-foreground text-xs">
              {t("ai:build.chat.appliedSummary", {
                done: applied,
                total: resultList.length,
              })}
            </p>
          )}
          {turn.status === "cancelled" && (
            <p className="text-muted-foreground text-xs">
              {t("ai:build.chat.cancelled")}
            </p>
          )}
          {turn.errorKey && (
            <p role="alert" className="text-destructive-foreground text-sm">
              {t(turn.errorKey)}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
