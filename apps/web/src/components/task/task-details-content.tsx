import { useNavigate } from "@tanstack/react-router";
import { format, isValid, parseISO } from "date-fns";
import { ArrowUpRight, CalendarIcon, X } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import Activity from "@/components/activity";
import ActivityFeedControls from "@/components/activity/activity-feed-controls";
import {
  arrangeActivities,
  groupCommentReplies,
} from "@/components/activity/activity-feed-options";
import CommentInput from "@/components/activity/comment-input";
import { AgentRunButton } from "@/components/ai/agents/agent-run-button";
import { TaskAgentWaiting } from "@/components/ai/agents/task-agent-waiting";
import { AiSpecDraftButton } from "@/components/ai/ai-spec-draft";
import { AiSummaryButton } from "@/components/ai/ai-summary";
import DescriptionTranslation from "@/components/ai/translate/description-translation";
import TaskTriageEntry from "@/components/ai/triage/task-triage-entry";
import ArchivedTaskBanner from "@/components/archives/archived-task-banner";
import { CodingHandoffTimeline } from "@/components/coding-agent/coding-handoff-timeline";
import { SendToCodingAgentButton } from "@/components/coding-agent/send-to-coding-agent";
import { ExternalLinksAccordion } from "@/components/external-links/external-links-accordion";
import IntakeTaskBanner from "@/components/intake/intake-task-banner";
import { TaskPageReferences } from "@/components/page/task-page-references";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import TaskVoteSummary from "@/components/publication/task-vote-summary";
import ReactionBar from "@/components/reaction/reaction-bar";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
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
import { Switch } from "@/components/ui/switch";
import { Timeline } from "@/components/ui/timeline";
import useSetCustomFieldValue from "@/hooks/mutations/custom-field/use-set-custom-field-value";
import useGetActivitiesByTaskId from "@/hooks/queries/activity/use-get-activities-by-task-id";
import useGetCustomFieldValuesByTask from "@/hooks/queries/custom-field/use-get-custom-field-values-by-task";
import useGetCustomFieldsByProject from "@/hooks/queries/custom-field/use-get-custom-fields-by-project";
import useExternalLinks from "@/hooks/queries/external-link/use-external-links";
import useGetProject from "@/hooks/queries/project/use-get-project";
import {
  usePublication,
  useTaskCommentAuthors,
} from "@/hooks/queries/publication/use-publication";
import useTaskReactions from "@/hooks/queries/reaction/use-task-reactions";
import useGetTask from "@/hooks/queries/task/use-get-task";
import useGetTaskRelations from "@/hooks/queries/task-relation/use-get-task-relations";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { publicCommentsOpen } from "@/lib/publication/settings";
import { formatTaskKey } from "@/lib/task-key";
import { oldestParent } from "@/lib/task-relations";
import { toast } from "@/lib/toast";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { ExternalLink } from "@/types/external-link";
import DescriptionHistoryButton from "./description-history/description-history-button";
import TaskAttachments, {
  type TaskAttachmentsHandle,
} from "./task-attachments";
import TaskDescription from "./task-description";
import TaskDetailActionBar from "./task-detail-action-bar";
import TaskKeyCopyButton from "./task-key-copy-button";
import TaskLinks, { type TaskLinksHandle } from "./task-links";
import TaskRelations, { type TaskRelationsHandle } from "./task-relations";
import TaskSubtasks, { type TaskSubtasksHandle } from "./task-subtasks";
import TaskTitle from "./task-title";

type CustomFieldType = "text" | "number" | "date" | "dropdown" | "boolean";

type CustomFieldDefinition = {
  id: string;
  projectId: string;
  name: string;
  type: CustomFieldType;
  required: boolean;
  defaultValue: string | null;
  options: string[] | null;
  position: number;
  createdAt: string;
  updatedAt: string;
};

const NO_FIELDS: CustomFieldDefinition[] = [];
const NO_VALUES: Array<{ fieldId: string; value: string | null }> = [];

type TaskDetailsContentProps = {
  taskId: string | undefined;
  projectId: string;
  workspaceId: string;
  className?: string;
  /**
   * The property grid, placed after the description (the sheet, and the
   * task page below 1024px where there is no side panel).
   */
  properties?: ReactNode;
  /** The key above the title; off where a header already shows it. */
  showKey?: boolean;
};

/**
 * The task body, top to bottom: banners, key and parent, title,
 * description and reactions, properties (when given), quick actions,
 * custom fields, the work items (sub-tasks, relations, links, attachments,
 * "Mentioned in pages", external resources), then activity and comments.
 */
export default function TaskDetailsContent({
  taskId,
  projectId,
  workspaceId,
  className,
  properties,
  showKey = true,
}: TaskDetailsContentProps) {
  const { t } = useTranslation();
  const activityHeadingId = useId();
  const navigate = useNavigate();
  const { data: task } = useGetTask(taskId ?? "");
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { data: allActivities = [] } = useGetActivitiesByTaskId(taskId ?? "");
  const activityFilter = useUserPreferencesStore(
    (state) => state.activityFilter,
  );
  const activitySort = useUserPreferencesStore((state) => state.activitySort);
  const activities = useMemo(
    () => arrangeActivities(allActivities, activityFilter, activitySort),
    [allActivities, activityFilter, activitySort],
  );
  const commentReplies = useMemo(
    () => groupCommentReplies(allActivities),
    [allActivities],
  );
  const { data: externalLinks = [], isLoading: isLoadingExternalLinks } =
    useExternalLinks(taskId ?? "");
  const { data: relations = [] } = useGetTaskRelations(taskId ?? "");
  const { data: reactions, isError: isReactionsError } = useTaskReactions(
    taskId ?? "",
  );
  // Comment cards read their groups from here: one request per task.
  const commentReactions = useMemo(
    () =>
      reactions
        ? new Map(
            reactions.comments.map((entry) => [entry.commentId, entry.groups]),
          )
        : undefined,
    [reactions],
  );
  // The project's public board: the comment visibility switch, outsider
  // badges, moderation and the vote summary (B12 §1.6).
  const boardProjectId = task?.projectId ?? projectId;
  const { data: publication } = usePublication(boardProjectId);
  const hasPublication = Boolean(publication?.linkToken);
  const { data: commentAuthors } = useTaskCommentAuthors(
    taskId,
    hasPublication,
  );
  const publicBoard = useMemo(
    () =>
      publication?.linkToken
        ? {
            projectId: boardProjectId,
            open: publicCommentsOpen(publication),
            canModerate: publication.canManage,
          }
        : undefined,
    [publication, boardProjectId],
  );
  const { user } = useAuth();

  // Stable empty lists: the effect below depends on them, and a fresh `[]`
  // per render looped while a closing sheet had no project id yet.
  const { data: customFields = NO_FIELDS } = useGetCustomFieldsByProject(
    projectId,
  ) as { data: CustomFieldDefinition[] | undefined };

  const { data: customFieldValues = NO_VALUES } = useGetCustomFieldValuesByTask(
    taskId ?? "",
  );

  const { mutateAsync: setCustomFieldValue } = useSetCustomFieldValue();
  const { canUpdateTasks } = useWorkspacePermission();
  const canEdit = canUpdateTasks();

  const subtasksRef = useRef<TaskSubtasksHandle>(null);
  const relationsRef = useRef<TaskRelationsHandle>(null);
  const linksRef = useRef<TaskLinksHandle>(null);
  const attachmentsRef = useRef<TaskAttachmentsHandle>(null);

  const [localValues, setLocalValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const valuesMap: Record<string, string> = {};

    for (const field of customFields) {
      valuesMap[field.id] = field.defaultValue || "";
    }

    for (const val of customFieldValues) {
      if (val.value !== null) {
        valuesMap[val.fieldId] = val.value;
      }
    }

    setLocalValues(valuesMap);
  }, [customFields, customFieldValues]);

  const handleLocalChange = (fieldId: string, val: string) => {
    setLocalValues((prev) => ({ ...prev, [fieldId]: val }));
  };

  const handleSaveField = async (fieldId: string, value: string) => {
    if (!taskId) return;

    const existingValObj = customFieldValues.find((v) => v.fieldId === fieldId);
    const existingVal = existingValObj ? (existingValObj.value ?? "") : "";

    if (value === existingVal) return;

    try {
      await setCustomFieldValue({
        taskId,
        fieldId,
        value,
        projectId,
      });

      toast.success(t("tasks:detail.customFieldUpdated", "Field updated"));
    } catch (error) {
      handleLocalChange(fieldId, existingVal);
      toast.error(
        error instanceof Error ? error.message : "Failed to update field",
      );
    }
  };

  // Legacy data can hold several parents; the oldest one is shown.
  const parentTask = taskId
    ? (oldestParent(relations, taskId)?.sourceTask ?? null)
    : null;

  if (!taskId) return null;

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <header className="flex flex-col gap-2">
        <IntakeTaskBanner
          taskId={taskId}
          projectId={task?.projectId ?? projectId}
          workspaceId={workspaceId}
        />

        <ArchivedTaskBanner task={task} />

        {(showKey || parentTask) && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {showKey && (
              <TaskKeyCopyButton
                slug={project?.slug}
                number={task?.number}
                className="font-medium font-mono text-muted-foreground text-xs"
              />
            )}
            {showKey && parentTask && (
              <span aria-hidden className="text-muted-foreground/60">
                ·
              </span>
            )}
            {parentTask && (
              <button
                type="button"
                className="flex min-w-0 items-center gap-1 rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() =>
                  navigate({
                    to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
                    params: {
                      workspaceId,
                      projectId: parentTask.projectId,
                      taskId: parentTask.id,
                    },
                  })
                }
              >
                <ArrowUpRight className="size-3 shrink-0" />
                <span className="truncate">
                  {t("tasks:detail.subtaskOf")}{" "}
                  <span className="font-mono">
                    {formatTaskKey(parentTask.projectSlug, parentTask.number)}
                  </span>{" "}
                  <span className="font-medium">{parentTask.title}</span>
                </span>
              </button>
            )}
          </div>
        )}

        <TaskTitle taskId={taskId} />
      </header>

      <div className="flex flex-col gap-2">
        <TaskDescription taskId={taskId} />
        {task?.description ? (
          <DescriptionTranslation
            kind="task"
            id={taskId}
            text={task.description}
            projectId={task.projectId}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <ReactionBar
            taskId={taskId}
            groups={isReactionsError ? [] : (reactions?.task ?? [])}
            showAddButton
          />
          <TaskVoteSummary
            taskId={taskId}
            votesEnabled={Boolean(publication?.votesEnabled)}
          />
          <DescriptionHistoryButton
            taskId={taskId}
            projectId={task?.projectId ?? projectId}
            className="ms-auto"
          />
        </div>
      </div>

      {properties}

      {task && (
        <TaskTriageEntry
          task={task}
          workspaceId={workspaceId}
          onEditDuplicate={() => relationsRef.current?.openAdd()}
        />
      )}

      <TaskDetailActionBar
        onAddSubtask={() => subtasksRef.current?.openCreate()}
        onAddRelation={() => relationsRef.current?.openAdd()}
        onAddLink={() => linksRef.current?.openAdd()}
        onAttachFile={() => attachmentsRef.current?.openPicker()}
        onDropFiles={(files) => attachmentsRef.current?.addFiles(files)}
      >
        {task && (
          <AiSummaryButton
            kind="task"
            id={taskId}
            projectId={task.projectId}
            workspaceId={workspaceId}
            name={task.title}
          />
        )}
        {task && (
          <AiSpecDraftButton
            taskId={taskId}
            projectId={task.projectId}
            workspaceId={workspaceId}
            taskTitle={task.title}
            taskKey={
              project?.slug
                ? formatTaskKey(project.slug, task.number)
                : undefined
            }
          />
        )}
        {task && (
          <SendToCodingAgentButton taskId={taskId} projectId={task.projectId} />
        )}
        {task && (
          <AgentRunButton
            taskId={taskId}
            projectId={task.projectId}
            workspaceId={workspaceId}
          />
        )}
      </TaskDetailActionBar>
      {customFields.length > 0 && (
        <div>
          <Accordion className="w-full">
            <AccordionItem
              value="custom-fields"
              className="rounded-lg border border-border bg-sidebar/30 px-4"
            >
              <AccordionTrigger className="py-4 hover:no-underline">
                <div className="flex items-center gap-2 text-left">
                  <span className="text-sm font-semibold text-foreground">
                    {t("tasks:common.customFields")}
                  </span>
                  <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {customFields.length}
                  </span>
                </div>
              </AccordionTrigger>

              <AccordionContent className="pb-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {customFields.map((field) => {
                    const val = localValues[field.id] ?? "";

                    return (
                      <div
                        key={`custom-field-${field.id}`}
                        className="space-y-1.5"
                      >
                        <label
                          htmlFor={`custom-field-${field.id}`}
                          className="flex items-center gap-1 text-xs font-medium text-muted-foreground"
                        >
                          {field.name}
                          {field.required && (
                            <span className="text-destructive">*</span>
                          )}
                        </label>

                        {field.type === "dropdown" ? (
                          <Select
                            value={val}
                            onValueChange={(newVal) => {
                              handleLocalChange(field.id, newVal as string);
                              void handleSaveField(field.id, newVal as string);
                            }}
                            disabled={!canEdit}
                          >
                            <SelectTrigger className="h-9 w-full bg-background text-sm">
                              <SelectValue
                                placeholder={t(
                                  "tasks:detail.selectOption",
                                  "Select option",
                                )}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {!field.required && (
                                <SelectItem key="empty" value="">
                                  {t("tasks:detail.selectOption")}
                                </SelectItem>
                              )}
                              {(field.options || []).map((opt) => (
                                <SelectItem key={opt} value={opt}>
                                  {opt}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : field.type === "date" ? (
                          <div className="relative w-full">
                            <Popover>
                              <PopoverTrigger
                                render={
                                  <Button
                                    variant="outline"
                                    type="button"
                                    disabled={!canEdit}
                                    className={cn(
                                      "h-10! w-full justify-start rounded-md bg-background pr-10 text-left text-sm font-normal",
                                      !val && "text-muted-foreground",
                                    )}
                                  >
                                    <CalendarIcon className="mr-2 size-4 shrink-0 opacity-70" />

                                    <span className="truncate">
                                      {val && isValid(parseISO(val))
                                        ? format(parseISO(val), "dd MMM yyyy")
                                        : t(
                                            "tasks:detail.pickDate",
                                            "Pick a date",
                                          )}
                                    </span>
                                  </Button>
                                }
                              />

                              <PopoverContent
                                side="bottom"
                                align="start"
                                className="w-auto p-0"
                              >
                                <Calendar
                                  mode="single"
                                  selected={
                                    val && isValid(parseISO(val))
                                      ? parseISO(val)
                                      : undefined
                                  }
                                  onSelect={(date) => {
                                    const iso = date
                                      ? format(date, "yyyy-MM-dd")
                                      : "";

                                    handleLocalChange(field.id, iso);
                                    void handleSaveField(field.id, iso);
                                  }}
                                  captionLayout="dropdown"
                                />
                              </PopoverContent>
                            </Popover>

                            {!field.required && (
                              <Button
                                variant="ghost"
                                type="button"
                                disabled={!canEdit || !val}
                                onClick={() => {
                                  handleLocalChange(field.id, "");
                                  void handleSaveField(field.id, "");
                                }}
                                className={cn(
                                  "absolute right-1 top-1/2 z-10 size-8 -translate-y-1/2 rounded-md p-0 text-muted-foreground",
                                  canEdit && val
                                    ? "hover:bg-destructive/10 hover:text-destructive"
                                    : "cursor-not-allowed",
                                )}
                                aria-label={t("reset", {
                                  field: field.name ?? field.id,
                                })}
                              >
                                <X
                                  className="size-4"
                                  strokeWidth={2.5}
                                  aria-hidden="true"
                                />
                              </Button>
                            )}
                          </div>
                        ) : field.type === "number" ? (
                          <Input
                            type="number"
                            value={val}
                            onChange={(e) =>
                              handleLocalChange(field.id, e.target.value)
                            }
                            onBlur={() => void handleSaveField(field.id, val)}
                            disabled={!canEdit}
                            className="h-9 w-full bg-background text-sm"
                          />
                        ) : field.type === "boolean" ? (
                          <div
                            className={cn(
                              "flex h-10 w-full items-center gap-3 rounded-md border border-input bg-muted/50 px-3 text-sm transition-colors",
                              canEdit && "hover:bg-muted",
                              !canEdit && "opacity-50",
                            )}
                          >
                            <span className="flex-1 truncate text-foreground">
                              {t(`common:boolean.${val || "notSet"}`)}
                            </span>

                            <Switch
                              checked={val === "true"}
                              onCheckedChange={(checked) => {
                                const nextValue = checked ? "true" : "false";

                                handleLocalChange(field.id, nextValue);
                                void handleSaveField(field.id, nextValue);
                              }}
                              disabled={!canEdit}
                              aria-label={t("modify", {
                                field: field.name ?? field.id,
                              })}
                            />

                            {!field.required && (
                              <Button
                                variant="ghost"
                                type="button"
                                disabled={!canEdit}
                                onClick={() => {
                                  handleLocalChange(field.id, "");
                                  void handleSaveField(field.id, "");
                                }}
                                className={cn(
                                  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
                                  canEdit
                                    ? "hover:bg-destructive/10 hover:text-destructive"
                                    : "cursor-not-allowed",
                                )}
                                aria-label={t("reset", {
                                  field: field.name ?? field.id,
                                })}
                              >
                                <X className="size-4" />
                              </Button>
                            )}
                          </div>
                        ) : (
                          <Input
                            type="text"
                            value={val}
                            onChange={(e) =>
                              handleLocalChange(field.id, e.target.value)
                            }
                            onBlur={() => void handleSaveField(field.id, val)}
                            disabled={!canEdit}
                            className="h-9 w-full bg-background text-sm"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}
      {/* The task's work items: each section hides or collapses itself. */}
      <div className="flex flex-col gap-3">
        {task && (
          <TaskSubtasks
            ref={subtasksRef}
            taskId={taskId}
            projectId={projectId}
            workspaceId={workspaceId}
            parentStatus={task.status}
          />
        )}

        <TaskRelations
          ref={relationsRef}
          taskId={taskId}
          projectId={projectId}
          workspaceId={workspaceId}
        />

        <TaskLinks ref={linksRef} taskId={taskId} />

        <TaskAttachments ref={attachmentsRef} taskId={taskId} />

        <TaskPageReferences
          taskId={taskId}
          projectId={task?.projectId ?? projectId}
          workspaceId={workspaceId}
        />

        <CodingHandoffTimeline taskId={taskId} />

        {!isLoadingExternalLinks && externalLinks.length > 0 && (
          <ExternalLinksAccordion
            externalLinks={externalLinks as ExternalLink[]}
            isLoading={isLoadingExternalLinks}
          />
        )}
      </div>

      <section
        aria-labelledby={activityHeadingId}
        className="flex flex-col gap-4 border-border border-t pt-5"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id={activityHeadingId} className="font-semibold text-sm">
            {t("tasks:detail.activity")}
          </h2>
          {allActivities.length > 0 && <ActivityFeedControls />}
        </div>

        {taskId && (
          <TaskAgentWaiting
            workspaceId={workspaceId}
            projectId={task?.projectId ?? projectId}
            taskId={taskId}
          />
        )}

        {user?.id && (
          <CommentInput
            taskId={taskId}
            projectId={task?.projectId}
            publicCommentsOpen={publicBoard?.open ?? false}
          />
        )}

        {activities.length > 0 ? (
          <Timeline>
            {activities.map((activity, index) => {
              return (
                <Activity
                  key={activity.id}
                  activity={activity}
                  step={activities.length - index}
                  rail
                  commentReactions={commentReactions}
                  commentAuthors={commentAuthors}
                  publicBoard={publicBoard}
                  replies={
                    activity.parentId
                      ? undefined
                      : (commentReplies.get(activity.id) ?? [])
                  }
                  canReply={Boolean(user?.id)}
                />
              );
            })}
          </Timeline>
        ) : (
          <p className="text-muted-foreground text-sm">
            {allActivities.length > 0
              ? t("activity:feed.noMatches")
              : t("tasks:detail.noActivity")}
          </p>
        )}
      </section>
    </div>
  );
}
