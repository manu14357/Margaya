import { createHash } from "node:crypto";
import type { AgentApi, ApiResult } from "./credential";

// The change set: every write an agent makes is one typed operation with
// its before and after values. Applying and undoing both call the API's own
// routes with a run key, so authorization, events, activity and webhooks
// apply exactly as for a person.

export type TaskFields = {
  title?: string;
  priority?: string;
  /** YYYY-MM-DD, or null for no due date. */
  dueDate?: string | null;
  description?: string;
};

type TaskRef = { taskId: string; projectId: string; taskLabel: string };

/** A page's title and Markdown content, the fields update_page changes. */
export type PageFields = { title?: string; content?: string };

export type Change =
  | (TaskRef & {
      op: "comment";
      content: string;
      /** A reply in this comment's thread. */
      parentId?: string;
    })
  | (TaskRef & { op: "update_task"; before: TaskFields; after: TaskFields })
  | (TaskRef & {
      op: "set_status";
      before: { status: string };
      after: { status: string };
    })
  | (TaskRef & {
      op: "create_subtask";
      title: string;
      description: string;
      status: string;
    })
  | (TaskRef & {
      op: "link_tasks";
      targetTaskId: string;
      targetLabel: string;
      relationType: string;
    })
  | (TaskRef & { op: "delete_task" })
  | {
      op: "create_page";
      projectId: string;
      /** Null: a project page linked to no task (scheduled reports). */
      taskId: string | null;
      /** The task's label, or the project's name for a project page. */
      taskLabel: string;
      title: string;
      /** Markdown. */
      content: string;
      /** The task's key and app path, for the link at the top of the page. */
      taskKey: string | null;
      taskUrl: string | null;
    }
  | {
      // Edits an existing page through the same content route people use,
      // so open editors see it like any edit and a version is recorded.
      op: "update_page";
      projectId: string;
      taskId: null;
      /** The page's title when the agent read it. */
      taskLabel: string;
      pageId: string;
      /** Whole content replaced, or a section added at the end. */
      mode: "replace" | "append";
      before: PageFields;
      after: PageFields;
      /** The added section (append), for review. */
      appended?: string;
      /** pageContentHash of the content the agent read. */
      baseHash: string;
    }
  | {
      op: "bulk_set_status";
      projectId: string;
      items: (TaskRef & { before: string; after: string })[];
    }
  | {
      // A tool call on an outside MCP server (ai-connectors). It always
      // waits for approval and can't be undone.
      op: "connector_call";
      projectId: string;
      taskId: string | null;
      connectorId: string;
      connectorName: string;
      tool: string;
      args: Record<string, unknown>;
      /** Whose connectors the run could use: checked again on approval. */
      workspaceId: string;
      principalUserId: string;
    };

export type ChangeOp = Change["op"];

/** What applying left behind, needed to undo it (ids of created rows). */
export type AppliedRef = {
  commentId?: string;
  taskId?: string;
  relationId?: string;
  pageId?: string;
  /** pageContentHash of a page's content right after the change. */
  pageHash?: string;
  /** The start of an outside tool's answer, for the change set. */
  connectorResult?: string;
};

/** Runs an approved connector call (registered by ai-connectors). */
export type ConnectorCaller = (
  change: Extract<Change, { op: "connector_call" }>,
) => Promise<string>;

let connectorCaller: ConnectorCaller | null = null;

export function setConnectorCaller(caller: ConnectorCaller | null): void {
  connectorCaller = caller;
}

export class ChangeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ChangeError";
  }
}

function must<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new ChangeError(result.message, result.status);
  return result.data;
}

const enc = encodeURIComponent;

/** A short fingerprint of a page's stored Markdown, to notice later edits. */
export function pageContentHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex").slice(0, 32);
}

type PageJson = { title: string; contentMarkdown: string };

async function readPage(api: AgentApi, pageId: string): Promise<PageJson> {
  return must(await api<PageJson>("GET", `/page/${enc(pageId)}`));
}

function attribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** The due-date route takes an instant; a calendar day means its noon UTC. */
function dueBody(day: string | null | undefined) {
  return day ? { dueDate: `${day}T12:00:00.000Z` } : {};
}

async function setFields(api: AgentApi, taskId: string, fields: TaskFields) {
  if (fields.title !== undefined) {
    must(
      await api("PUT", `/task/title/${enc(taskId)}`, { title: fields.title }),
    );
  }
  if (fields.priority !== undefined) {
    must(
      await api("PUT", `/task/priority/${enc(taskId)}`, {
        priority: fields.priority,
      }),
    );
  }
  if (fields.dueDate !== undefined) {
    must(
      await api(
        "PUT",
        `/task/due-date/${enc(taskId)}`,
        dueBody(fields.dueDate),
      ),
    );
  }
  if (fields.description !== undefined) {
    must(
      await api("PUT", `/task/description/${enc(taskId)}`, {
        description: fields.description,
      }),
    );
  }
}

export async function applyChange(
  api: AgentApi,
  change: Change,
): Promise<AppliedRef> {
  switch (change.op) {
    case "comment": {
      const comment = must(
        await api<{ id: string }>("POST", `/comment/${enc(change.taskId)}`, {
          content: change.content,
          ...(change.parentId ? { parentId: change.parentId } : {}),
        }),
      );
      return { commentId: comment.id };
    }
    case "update_task":
      await setFields(api, change.taskId, change.after);
      return {};
    case "set_status":
      must(
        await api("PUT", `/task/status/${enc(change.taskId)}`, change.after),
      );
      return {};
    case "create_subtask": {
      const task = must(
        await api<{ id: string }>("POST", `/task/${enc(change.projectId)}`, {
          title: change.title,
          description: change.description,
          priority: "no-priority",
          status: change.status,
          assigneeIds: [],
          parentId: change.taskId,
        }),
      );
      return { taskId: task.id };
    }
    case "link_tasks": {
      const relation = must(
        await api<{ id: string }>("POST", "/task-relation", {
          sourceTaskId: change.taskId,
          targetTaskId: change.targetTaskId,
          relationType: change.relationType,
        }),
      );
      return { relationId: relation.id };
    }
    case "delete_task":
      must(await api("DELETE", `/task/${enc(change.taskId)}`));
      return {};
    case "create_page": {
      // The task link makes the page show under the task's "Mentioned in
      // pages", as a drafted spec does.
      const link =
        change.taskId && change.taskUrl && change.taskKey
          ? `<margaya-issue-link url="${attribute(change.taskUrl)}" issue-key="${attribute(change.taskKey)}" task-id="${attribute(change.taskId)}" />\n\n`
          : "";
      const page = must(
        await api<{ id: string }>(
          "POST",
          `/page/project/${enc(change.projectId)}`,
          {
            title: change.title,
            access: "public",
            content: `${link}${change.content.trim()}\n`,
          },
        ),
      );
      return { pageId: page.id };
    }
    case "update_page": {
      // Held for approval, a person may have edited the page meanwhile:
      // never overwrite their work with what the agent planned before it.
      const current = await readPage(api, change.pageId);
      if (
        pageContentHash(current.contentMarkdown) !== change.baseHash ||
        (change.before.title !== undefined &&
          current.title !== change.before.title)
      ) {
        throw new ChangeError(
          "The page changed after you read it. Read it again before editing.",
          409,
        );
      }
      let page = current;
      if (change.after.title !== undefined) {
        page = must(
          await api<PageJson>("PATCH", `/page/${enc(change.pageId)}`, {
            title: change.after.title,
          }),
        );
      }
      if (change.after.content !== undefined) {
        page = must(
          await api<PageJson>("PUT", `/page/${enc(change.pageId)}/content`, {
            markdown: change.after.content,
          }),
        );
      }
      return {
        pageId: change.pageId,
        pageHash: pageContentHash(page.contentMarkdown),
      };
    }
    case "connector_call": {
      if (!connectorCaller) throw new ChangeError("Connectors are off", 409);
      const text = await connectorCaller(change);
      return { connectorResult: text.slice(0, 500) };
    }
    case "bulk_set_status":
      for (const item of change.items) {
        must(
          await api("PUT", `/task/status/${enc(item.taskId)}`, {
            status: item.after,
          }),
        );
      }
      return {};
  }
}

/** Replays the inverse operation of an applied change. */
export async function undoChange(
  api: AgentApi,
  change: Change,
  ref: AppliedRef,
): Promise<void> {
  switch (change.op) {
    case "comment":
      if (!ref.commentId) throw new ChangeError("Nothing to undo", 409);
      must(await api("DELETE", `/comment/${enc(ref.commentId)}`));
      return;
    case "update_task":
      await setFields(api, change.taskId, change.before);
      return;
    case "set_status":
      must(
        await api("PUT", `/task/status/${enc(change.taskId)}`, change.before),
      );
      return;
    case "create_subtask":
      if (!ref.taskId) throw new ChangeError("Nothing to undo", 409);
      must(await api("DELETE", `/task/${enc(ref.taskId)}`));
      return;
    case "link_tasks":
      if (!ref.relationId) throw new ChangeError("Nothing to undo", 409);
      must(await api("DELETE", `/task-relation/${enc(ref.relationId)}`));
      return;
    case "delete_task":
      must(await api("POST", `/trash/task/${enc(change.taskId)}/restore`));
      return;
    case "create_page":
      // Archived, not deleted: it can still be restored from the page list.
      if (!ref.pageId) throw new ChangeError("Nothing to undo", 409);
      must(await api("POST", `/page/${enc(ref.pageId)}/archive`));
      return;
    case "update_page": {
      // Only while the page is as the agent left it: a later edit by
      // anyone would be lost. Page history still has every version.
      if (!ref.pageHash) throw new ChangeError("Nothing to undo", 409);
      const current = await readPage(api, change.pageId);
      if (
        pageContentHash(current.contentMarkdown) !== ref.pageHash ||
        (change.after.title !== undefined &&
          current.title !== change.after.title)
      ) {
        throw new ChangeError(
          "The page was edited after this change. Restore an earlier version from the page's history instead.",
          409,
        );
      }
      if (change.before.content !== undefined) {
        must(
          await api("PUT", `/page/${enc(change.pageId)}/content`, {
            markdown: change.before.content,
          }),
        );
      }
      if (change.before.title !== undefined) {
        must(
          await api("PATCH", `/page/${enc(change.pageId)}`, {
            title: change.before.title,
          }),
        );
      }
      return;
    }
    case "connector_call":
      throw new ChangeError("Calls to outside services can't be undone", 409);
    case "bulk_set_status":
      for (const item of change.items) {
        must(
          await api("PUT", `/task/status/${enc(item.taskId)}`, {
            status: item.before,
          }),
        );
      }
      return;
  }
}

/** The permissions applying or undoing an operation needs. */
export function changePermissions(
  change: Change,
  direction: "apply" | "undo",
): Record<string, string[]> {
  switch (change.op) {
    case "create_subtask":
      return direction === "apply"
        ? { task: ["create", "update"] }
        : { task: ["delete"] };
    case "delete_task":
      return { task: ["delete"] };
    case "create_page":
      return direction === "apply"
        ? { page: ["create"] }
        : { page: ["update"] };
    case "update_page":
      return { page: ["update"] };
    case "connector_call":
      // Outside services check their own credentials; the project must
      // still be within reach (asAgentFor).
      return {};
    default:
      return { task: ["update"] };
  }
}

/** The tasks a change touches (scope checks before applying). */
export function changeProjectIds(change: Change): string[] {
  return [change.projectId];
}

/** A short English line for the audit log and notifications. */
export function describeChange(change: Change): string {
  switch (change.op) {
    case "comment":
      return change.parentId
        ? `Reply to a comment on ${change.taskLabel}`
        : `Comment on ${change.taskLabel}`;
    case "update_task":
      return `Update ${Object.keys(change.after).join(", ")} of ${change.taskLabel}`;
    case "set_status":
      return `Move ${change.taskLabel} to ${change.after.status}`;
    case "create_subtask":
      return `Create sub-task "${change.title}" under ${change.taskLabel}`;
    case "link_tasks":
      return `Link ${change.taskLabel} (${change.relationType}) ${change.targetLabel}`;
    case "delete_task":
      return `Delete ${change.taskLabel}`;
    case "create_page":
      return `Create page "${change.title}" for ${change.taskLabel}`;
    case "update_page":
      return change.mode === "append"
        ? `Add a section to page "${change.after.title ?? change.taskLabel}"`
        : change.after.content === undefined
          ? `Rename page "${change.taskLabel}" to "${change.after.title}"`
          : `Update page "${change.after.title ?? change.taskLabel}"`;
    case "bulk_set_status":
      return `Move ${change.items.length} tasks`;
    case "connector_call":
      return `Call ${change.tool} on ${change.connectorName}`;
  }
}
