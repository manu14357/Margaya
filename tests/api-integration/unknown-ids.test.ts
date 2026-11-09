import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  addWorkspaceMember,
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

// The contract for ids that point at nothing the caller may use: every
// operation that names a task, project, page, cycle or module in its path
// answers a documented 404 when that id is unknown, in the trash, or in a
// restricted project the caller is not a member of. The three cases must not
// be told apart, and none may fall through to an undocumented status.

type Operation = { operationId: string; responses: Record<string, unknown> };
type Spec = { paths: Record<string, Record<string, Operation>> };
type Kind = "taskId" | "projectId" | "pageId" | "cycleId" | "moduleId";

const METHODS = ["get", "post", "put", "patch", "delete"];
const KINDS: readonly string[] = [
  "taskId",
  "projectId",
  "pageId",
  "cycleId",
  "moduleId",
];
// `{id}` names the entity of the route's first path segment.
const ID_OF_SEGMENT: Record<string, Kind> = {
  task: "taskId",
  project: "projectId",
  "public-project": "projectId",
  page: "pageId",
  cycle: "cycleId",
  module: "moduleId",
};

function kindOf(path: string, param: string): string {
  const segment = path.split("/")[1] ?? "";
  return param === "id" ? (ID_OF_SEGMENT[segment] ?? param) : param;
}

const FEATURES_ON = {
  cyclesEnabled: true,
  modulesEnabled: true,
  pagesEnabled: true,
  viewsEnabled: true,
  intakeEnabled: true,
  estimatesEnabled: true,
  timeTrackingEnabled: true,
};

async function projectWithWork(workspaceId: string, ownerId: string) {
  const { project, columns } = await createProjectFixture({ workspaceId });
  await db
    .update(schema.projectTable)
    .set(FEATURES_ON)
    .where(eq(schema.projectTable.id, project.id));
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Task",
      status: "to-do",
      columnId: columns.todo.id,
      number: 1,
      position: 1,
    })
    .returning();
  const [page] = await db
    .insert(schema.pageTable)
    .values({ workspaceId, projectId: project.id, ownerId, title: "Page" })
    .returning();
  const [cycle] = await db
    .insert(schema.cycleTable)
    .values({ projectId: project.id, name: "Cycle" })
    .returning();
  const [module] = await db
    .insert(schema.moduleTable)
    .values({ projectId: project.id, name: "Module" })
    .returning();
  if (!task || !page || !cycle || !module) throw new Error("seed failed");
  return {
    projectId: project.id,
    taskId: task.id,
    pageId: page.id,
    cycleId: cycle.id,
    moduleId: module.id,
  } satisfies Record<Kind, string>;
}

describe("API integration: unknown, trashed and hidden ids", () => {
  let app: ReturnType<typeof createApp>["app"];
  let spec: Spec;
  let owner: typeof schema.userTable.$inferSelect;
  let member: typeof schema.userTable.$inferSelect;
  let live: Record<Kind, string> & { workspaceId: string };
  let trashed: Record<Kind, string>;
  let hidden: Record<Kind, string>;

  beforeAll(async () => {
    await resetTestDatabase();
    app = createApp().app;
    spec = (await (await app.request("/api/openapi")).json()) as Spec;

    const scene = await createWorkspaceMember({ role: "owner" });
    owner = scene.user;
    member = await addWorkspaceMember(scene.workspace.id, "member");
    const workspaceId = scene.workspace.id;
    live = { workspaceId, ...(await projectWithWork(workspaceId, owner.id)) };

    // A trashed task and page in the live project; the rest lives in a
    // project in the trash.
    const inTrash = await projectWithWork(workspaceId, owner.id);
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, inTrash.projectId));
    const elsewhere = await projectWithWork(workspaceId, owner.id);
    await db
      .update(schema.taskTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.taskTable.id, elsewhere.taskId));
    await db
      .update(schema.pageTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.pageTable.id, elsewhere.pageId));
    trashed = {
      ...inTrash,
      taskId: elsewhere.taskId,
      pageId: elsewhere.pageId,
    };

    // The member is not a member of this restricted project.
    hidden = await projectWithWork(workspaceId, owner.id);
    await db
      .update(schema.projectTable)
      .set({ visibility: "restricted" })
      .where(eq(schema.projectTable.id, hidden.projectId));
  });

  it("answers a documented 404 on every route that names one", async () => {
    const failures: string[] = [];
    let checked = 0;
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!METHODS.includes(method)) continue;
        const params = [...path.matchAll(/\{(\w+)\}/g)].map(
          (match) => match[1] ?? "",
        );
        for (const param of params) {
          const kind = kindOf(path, param);
          if (!KINDS.includes(kind)) continue;
          const cases: Array<[string, string, typeof owner]> = [
            ["unknown", "unknown-id", owner],
            ["hidden", hidden[kind as Kind], member],
          ];
          // Trash routes act on trashed ids on purpose.
          if (!path.startsWith("/trash/")) {
            cases.push(["trashed", trashed[kind as Kind], owner]);
          }
          for (const [label, value, caller] of cases) {
            const url = path.replace(/\{(\w+)\}/g, (_, name: string) =>
              name === param
                ? value
                : ((live as Record<string, string>)[kindOf(path, name)] ??
                  `other-${name}`),
            );
            mockAuthenticatedSession(caller);
            const writes = ["post", "put", "patch"].includes(method);
            const response = await app.request(`/api${url}`, {
              method: method.toUpperCase(),
              ...(writes
                ? {
                    headers: { "content-type": "application/json" },
                    body: "{}",
                  }
                : {}),
            });
            checked++;
            const documented = Object.keys(operation.responses);
            if (response.status !== 404 || !documented.includes("404")) {
              failures.push(
                `${method.toUpperCase()} ${path} (${label} ${param}) -> ${response.status}, documented ${documented.join(",")}: ${(await response.text()).slice(0, 80)}`,
              );
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
    expect(failures).toEqual([]);
  }, 300_000);
});
