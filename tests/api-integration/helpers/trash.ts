import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, vi } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { draftScene } from "./drafts";

export type TaskJson = {
  id: string;
  projectId: string;
  number: number;
  title: string;
  status: string;
  columnId?: string | null;
  deletedAt?: string | null;
};

export type TrashListJson = {
  items: Array<{
    id: string;
    key: string;
    title: string;
    status: string;
    subTaskCount: number;
    deletedAt: string;
    deletedBy: { id: string; name: string } | null;
    purgeAt: string | null;
  }>;
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
};

export type ProjectTrashJson = {
  items: Array<{
    id: string;
    name: string;
    slug: string;
    taskCount: number;
    deletedBy: { id: string; name: string } | null;
  }>;
  total: number;
};

/**
 * The draft scene (Owen owner, Ada admin, Mia member, Vic viewer, projects
 * "web" and "api") plus task and trash helpers. Ada deletes and restores.
 */
export async function trashScene() {
  const s = await draftScene();

  const createTask = (
    title: string,
    {
      projectId = s.web.project.id,
      status = "to-do",
      assigneeIds = [s.ada.id],
    } = {},
  ) =>
    s.ok<TaskJson>(s.ada, "POST", `/task/${projectId}`, {
      title,
      description: "",
      priority: "low",
      status,
      assigneeIds,
    });

  const makeSubtask = async (parentId: string, childId: string) => {
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: parentId,
      targetTaskId: childId,
      relationType: "subtask",
    });
  };

  const trash = (taskId: string) =>
    s.ok<TaskJson>(s.ada, "DELETE", `/task/${taskId}`);
  const restore = (taskId: string) =>
    s.ok<TaskJson>(s.ada, "POST", `/trash/task/${taskId}/restore`);
  const purge = (taskId: string) =>
    s.ok<TaskJson>(s.ada, "DELETE", `/trash/task/${taskId}`);
  const list = (projectId = s.web.project.id, query = "") =>
    s.ok<TrashListJson>(
      s.ada,
      "GET",
      `/trash/project/${projectId}/tasks${query}`,
    );

  const taskRow = async (id: string) => {
    const [row] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, id));
    return row ?? null;
  };

  /** Task ids the task query engine returns for the workspace. */
  const queryIds = async (body: Record<string, unknown> = {}) => {
    const result = await s.ok<{ ids?: string[] }>(
      s.ada,
      "POST",
      "/task-query",
      {
        workspaceId: s.workspaceId,
        mode: "ids",
        ...body,
      },
    );
    return result.ids ?? [];
  };

  /** Task ids on the project's board (columns, archived and planned). */
  const boardIds = async (projectId = s.web.project.id) => {
    const { data: board } = await s.ok<{
      data: {
        columns: Array<{ tasks: Array<{ id: string }> }>;
        archivedTasks: Array<{ id: string }>;
        plannedTasks: Array<{ id: string }>;
      };
    }>(s.ada, "GET", `/task/tasks/${projectId}?limit=100`);
    return [
      ...board.columns.flatMap((column) => column.tasks),
      ...board.archivedTasks,
      ...board.plannedTasks,
    ].map((task) => task.id);
  };

  const searchIds = async (q: string) => {
    const result = await s.ok<{ results: Array<{ id: string; type: string }> }>(
      s.ada,
      "GET",
      `/search?q=${encodeURIComponent(q)}&workspaceId=${s.workspaceId}&type=all`,
    );
    return result.results;
  };

  return {
    ...s,
    createTask,
    makeSubtask,
    trash,
    restore,
    purge,
    list,
    taskRow,
    queryIds,
    boardIds,
    searchIds,
  };
}

/** Calls an MCP tool as `userId` through a fresh API key. */
export async function callMcpTool(
  app: {
    request: (
      input: Request | string,
      init?: RequestInit,
    ) => Response | Promise<Response>;
  },
  userId: string,
  name: string,
  args: Record<string, unknown>,
) {
  const key = `trash-mcp-${userId}`;
  await db
    .insert(schema.apikeyTable)
    .values({
      referenceId: userId,
      userId,
      key: createHash("sha256").update(key).digest("base64url"),
      name: "mcp key",
      createdAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    })
    .onConflictDoNothing();
  vi.restoreAllMocks();
  // The tools call the API over HTTP; route those calls into this app.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    app.request(new Request(input, init)),
  );
  const protocolVersion = "2026-07-28";
  try {
    const response = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-method": "tools/call",
        "mcp-name": name,
        "mcp-protocol-version": protocolVersion,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name,
          arguments: args,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": protocolVersion,
            "io.modelcontextprotocol/clientInfo": { name: "it", version: "1" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    const data = text
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice(6);
    const body = JSON.parse(data ?? text) as {
      result: { isError?: boolean; content: Array<{ text: string }> };
    };
    return {
      isError: Boolean(body.result.isError),
      text: body.result.content.map((part) => part.text).join("\n"),
    };
  } finally {
    vi.unstubAllGlobals();
  }
}
