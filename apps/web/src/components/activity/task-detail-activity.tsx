import { Link } from "@tanstack/react-router";
import {
  Calendar,
  CopyPlus,
  FileText,
  Link as LinkIcon,
  ListTree,
  Paperclip,
  Repeat,
  Tag,
  Waypoints,
} from "lucide-react";
import type { ReactNode } from "react";
import { Trans } from "react-i18next";
import { formatDateMedium } from "@/lib/format";
import { resolveLabelColor } from "@/lib/label-color";
import { recurrenceSummary } from "@/lib/recurrence";
import {
  isRelationDisplayKey,
  RELATION_META,
  type RelationDisplayKey,
} from "@/lib/task-relations";

// History lines for the task-detail activity types (start date, labels,
// description, relations, parent, links, attachments, copies). Rows carry
// snapshots, so tasks, files and links that are gone still read well.

type Translate = (key: string, options?: Record<string, unknown>) => string;

type ActivityLike = { type: string; eventData?: unknown };

type Context = { workspaceId?: string };

const TITLE_LIMIT = 60;

const RELATION_ADDED_KEYS: Record<RelationDisplayKey, string> = {
  related: "activity:relationAdded.related",
  blocking: "activity:relationAdded.blocking",
  blocked_by: "activity:relationAdded.blocked_by",
  duplicate: "activity:relationAdded.duplicate",
  start_before: "activity:relationAdded.start_before",
  start_after: "activity:relationAdded.start_after",
  finish_before: "activity:relationAdded.finish_before",
  finish_after: "activity:relationAdded.finish_after",
};

// A task the API won't name to this reader (it is in a project they can't
// see) gets a whole sentence of its own: languages decline "a task in another
// project" differently in each slot, so it can't be dropped into one.
const RELATION_ADDED_HIDDEN_KEYS: Record<RelationDisplayKey, string> = {
  related: "activity:relationAddedHidden.related",
  blocking: "activity:relationAddedHidden.blocking",
  blocked_by: "activity:relationAddedHidden.blocked_by",
  duplicate: "activity:relationAddedHidden.duplicate",
  start_before: "activity:relationAddedHidden.start_before",
  start_after: "activity:relationAddedHidden.start_after",
  finish_before: "activity:relationAddedHidden.finish_before",
  finish_after: "activity:relationAddedHidden.finish_after",
};

const iconClass = "h-4 w-4";

/** The icon of a task-detail activity type, or null for other types. */
export function getTaskDetailActivityIcon(type: string): ReactNode {
  switch (type) {
    case "start_date_changed":
      return <Calendar className={iconClass} />;
    case "label_added":
    case "label_removed":
      return <Tag className={iconClass} />;
    case "description_changed":
      return <FileText className={iconClass} />;
    case "relation_added":
    case "relation_removed":
      return <Waypoints className={iconClass} />;
    case "parent_changed":
    case "subtask_added":
    case "subtask_removed":
      return <ListTree className={iconClass} />;
    case "link_added":
    case "link_updated":
    case "link_removed":
      return <LinkIcon className={iconClass} />;
    case "attachment_added":
    case "attachment_removed":
      return <Paperclip className={iconClass} />;
    case "copied_from":
    case "copied_to":
      return <CopyPlus className={iconClass} />;
    case "recurrence_set":
    case "recurrence_removed":
    case "recurred_from":
    case "recurred_to":
      return <Repeat className={iconClass} />;
    default:
      return null;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function truncate(value: string, limit = TITLE_LIMIT): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

type TaskRefData = {
  id: string | null;
  key: string | null;
  title: string | null;
  projectId: string | null;
};

/** "KEY-12 Title": the key and the title, either one when the other is gone. */
export function taskRefLabel(ref: TaskRefData): string {
  const title = ref.title ? truncate(ref.title) : null;
  return [ref.key, title].filter(Boolean).join(" ") || "…";
}

/**
 * A task named in a history line, linked to its own project. It renders its
 * own label rather than the parsed sentence, so a title that looks like
 * markup stays text.
 */
function TaskRef({
  data,
  workspaceId,
}: {
  data: TaskRefData;
  workspaceId?: string;
  children?: ReactNode;
}) {
  const label = taskRefLabel(data);
  if (!workspaceId || !data.id || !data.projectId) {
    return <span className="font-medium text-foreground">{label}</span>;
  }
  return (
    <Link
      to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
      params={{ workspaceId, projectId: data.projectId, taskId: data.id }}
      className="font-medium text-foreground hover:underline"
    >
      {label}
    </Link>
  );
}

function LabelRef({
  name,
  color,
}: {
  name: string;
  color: string | null;
  children?: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 font-medium text-foreground">
      <span
        className="inline-block size-2 shrink-0 rounded-full"
        style={{ backgroundColor: resolveLabelColor(color ?? "gray") }}
      />
      {name}
    </span>
  );
}

function otherTaskRef(data: Record<string, unknown>): TaskRefData {
  return {
    id: text(data.otherTaskId),
    key: text(data.otherTaskKey),
    title: text(data.otherTaskTitle),
    projectId: text(data.otherProjectId),
  };
}

function parentRef(value: unknown): TaskRefData | null {
  const data = record(value);
  const id = text(data.id);
  if (!id) return null;
  return {
    id,
    key: text(data.key),
    title: text(data.title),
    projectId: text(data.projectId),
  };
}

function formatDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : formatDateMedium(date);
}

const lineClass = "text-sm text-muted-foreground";

function line(content: ReactNode) {
  return <span className={lineClass}>{content}</span>;
}

/** A sentence naming one task: `<task>{{task}}</task>` in the copy. */
function withTask(key: string, ref: TaskRefData, context: Context) {
  return line(
    <Trans
      i18nKey={key}
      // The link renders its own label (see TaskRef).
      values={{ task: taskRefLabel(ref).replace(/[<>]/g, "") }}
      components={{
        task: <TaskRef data={ref} workspaceId={context.workspaceId} />,
      }}
    />,
  );
}

/**
 * The history line of a task-detail activity, or null when the type is not
 * one of them (the caller then falls back to its own rendering).
 */
export function renderTaskDetailActivity(
  activity: ActivityLike,
  t: Translate,
  context: Context = {},
): ReactNode {
  const data = record(activity.eventData);

  switch (activity.type) {
    case "start_date_changed": {
      const from = formatDate(data.oldStartDate);
      const to = formatDate(data.newStartDate);
      if (!to) return line(t("activity:clearedStartDate"));
      return line(
        from
          ? t("activity:changedStartDate", { from, to })
          : t("activity:setStartDate", { date: to }),
      );
    }
    case "label_added":
    case "label_removed": {
      const name = text(data.name) ?? "";
      return line(
        <Trans
          i18nKey={
            activity.type === "label_added"
              ? "activity:addedLabel"
              : "activity:removedLabel"
          }
          values={{ name: name.replace(/[<>]/g, "") }}
          components={{
            label: <LabelRef name={name} color={text(data.color)} />,
          }}
        />,
      );
    }
    case "description_changed":
      return line(t("activity:updatedDescription"));
    case "relation_added": {
      const relation = isRelationDisplayKey(data.relation)
        ? data.relation
        : "related";
      if (data.otherTaskHidden === true) {
        return line(t(RELATION_ADDED_HIDDEN_KEYS[relation]));
      }
      return withTask(
        RELATION_ADDED_KEYS[relation],
        otherTaskRef(data),
        context,
      );
    }
    case "relation_removed": {
      const relation = isRelationDisplayKey(data.relation)
        ? data.relation
        : "related";
      if (data.otherTaskHidden === true) {
        return line(
          t("activity:relationRemovedHidden", {
            relation: t(RELATION_META[relation].typeKey),
          }),
        );
      }
      const ref = otherTaskRef(data);
      return line(
        <Trans
          i18nKey="activity:relationRemoved"
          values={{
            relation: t(RELATION_META[relation].typeKey),
            task: taskRefLabel(ref).replace(/[<>]/g, ""),
          }}
          components={{
            task: <TaskRef data={ref} workspaceId={context.workspaceId} />,
          }}
        />,
      );
    }
    case "parent_changed": {
      const oldHidden = record(data.oldParent).hidden === true;
      const newHidden = record(data.newParent).hidden === true;
      const oldParent = parentRef(data.oldParent);
      const newParent = parentRef(data.newParent);
      if (oldHidden && newHidden) {
        return line(t("activity:parentChangedBetweenHidden"));
      }
      if (oldHidden && newParent) {
        return line(
          <Trans
            i18nKey="activity:parentChangedFromHidden"
            values={{ to: taskRefLabel(newParent).replace(/[<>]/g, "") }}
            components={{
              to: (
                <TaskRef data={newParent} workspaceId={context.workspaceId} />
              ),
            }}
          />,
        );
      }
      if (newHidden && oldParent) {
        return line(
          <Trans
            i18nKey="activity:parentChangedToHidden"
            values={{ from: taskRefLabel(oldParent).replace(/[<>]/g, "") }}
            components={{
              from: (
                <TaskRef data={oldParent} workspaceId={context.workspaceId} />
              ),
            }}
          />,
        );
      }
      if (newHidden) return line(t("activity:parentSetHidden"));
      if (oldParent && newParent) {
        return line(
          <Trans
            i18nKey="activity:parentChanged"
            values={{
              from: taskRefLabel(oldParent).replace(/[<>]/g, ""),
              to: taskRefLabel(newParent).replace(/[<>]/g, ""),
            }}
            components={{
              from: (
                <TaskRef data={oldParent} workspaceId={context.workspaceId} />
              ),
              to: (
                <TaskRef data={newParent} workspaceId={context.workspaceId} />
              ),
            }}
          />,
        );
      }
      if (newParent) return withTask("activity:parentSet", newParent, context);
      if (oldHidden) return line(t("activity:parentRemovedHidden"));
      if (oldParent) {
        return withTask("activity:parentRemoved", oldParent, context);
      }
      return null;
    }
    case "subtask_added":
      if (data.otherTaskHidden === true) {
        return line(t("activity:subtaskAddedHidden"));
      }
      return withTask("activity:subtaskAdded", otherTaskRef(data), context);
    case "subtask_removed":
      if (data.otherTaskHidden === true) {
        return line(t("activity:subtaskRemovedHidden"));
      }
      return withTask("activity:subtaskRemoved", otherTaskRef(data), context);
    case "link_added":
    case "link_updated":
    case "link_removed": {
      const title = text(data.title) ?? text(data.host) ?? text(data.url) ?? "";
      const key =
        activity.type === "link_added"
          ? "activity:linkAdded"
          : activity.type === "link_updated"
            ? "activity:linkUpdated"
            : "activity:linkRemoved";
      return line(t(key, { title }));
    }
    case "attachment_added":
    case "attachment_removed": {
      const filename = text(data.filename) ?? "";
      return line(
        activity.type === "attachment_added"
          ? t("activity:attachmentAdded", { filename })
          : t("activity:attachmentRemoved", { filename }),
      );
    }
    case "copied_from":
      if (data.sourceTaskHidden === true) {
        return line(t("activity:copiedFromHidden"));
      }
      return withTask(
        "activity:copiedFrom",
        {
          id: text(data.sourceTaskId),
          key: text(data.sourceTaskKey),
          title: text(data.sourceTaskTitle),
          projectId: text(data.sourceProjectId),
        },
        context,
      );
    case "copied_to":
      if (data.copyTaskHidden === true) {
        return line(t("activity:copiedToHidden"));
      }
      return withTask(
        "activity:copiedTo",
        {
          id: text(data.copyTaskId),
          key: text(data.copyTaskKey),
          title: text(data.copyTaskTitle),
          projectId: text(data.copyProjectId),
        },
        context,
      );
    case "recurrence_set": {
      const summary = recurrenceSummary(
        {
          frequency: text(data.frequency) ?? "daily",
          interval: typeof data.interval === "number" ? data.interval : 1,
          weekdays: Array.isArray(data.weekdays)
            ? data.weekdays.filter(
                (day): day is number => typeof day === "number",
              )
            : null,
          monthDay: typeof data.monthDay === "number" ? data.monthDay : null,
          endDate: text(data.endDate),
          maxOccurrences:
            typeof data.maxOccurrences === "number"
              ? data.maxOccurrences
              : null,
        },
        t,
      );
      return line(
        data.updated === true
          ? t("tasks:recurrence.activity.updated", { summary })
          : t("tasks:recurrence.activity.set", { summary }),
      );
    }
    case "recurrence_removed":
      return line(t("tasks:recurrence.activity.removed"));
    case "recurred_from": {
      const scheduled = data.reason === "schedule";
      if (data.sourceTaskHidden === true) {
        return line(
          scheduled
            ? t("tasks:recurrence.activity.recurredFromScheduledHidden")
            : t("tasks:recurrence.activity.recurredFromHidden"),
        );
      }
      return withTask(
        scheduled
          ? "tasks:recurrence.activity.recurredFromScheduled"
          : "tasks:recurrence.activity.recurredFrom",
        {
          id: text(data.sourceTaskId),
          key: text(data.sourceTaskKey),
          title: text(data.sourceTaskTitle),
          projectId: text(data.projectId),
        },
        context,
      );
    }
    case "recurred_to": {
      const scheduled = data.reason === "schedule";
      if (data.nextTaskHidden === true) {
        return line(
          scheduled
            ? t("tasks:recurrence.activity.recurredToScheduledHidden")
            : t("tasks:recurrence.activity.recurredToHidden"),
        );
      }
      return withTask(
        scheduled
          ? "tasks:recurrence.activity.recurredToScheduled"
          : "tasks:recurrence.activity.recurredTo",
        {
          id: text(data.nextTaskId),
          key: text(data.nextTaskKey),
          title: text(data.nextTaskTitle),
          projectId: text(data.projectId),
        },
        context,
      );
    }
    default:
      return null;
  }
}
