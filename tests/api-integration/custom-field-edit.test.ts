import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { automationRuleTable } from "../../apps/api/src/database/schema";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  countsByGroup,
  idsByGroup,
  json,
  orderedIds,
  queryScene,
} from "./helpers/task-query";

beforeEach(resetTestDatabase);

type Scene = Awaited<ReturnType<typeof queryScene>>;

async function createField(
  s: Scene,
  values: Partial<typeof schema.customFieldDefinitionTable.$inferInsert> = {},
) {
  const [field] = await db
    .insert(schema.customFieldDefinitionTable)
    .values({
      projectId: s.project.id,
      name: "Stage",
      type: "dropdown",
      options: ["Alpha", "Beta", "Gamma"],
      position: 0,
      ...values,
    })
    .returning();
  if (!field) throw new Error("Failed to create field");
  return field;
}

async function setValue(taskId: string, fieldId: string, value: string) {
  await db
    .insert(schema.customFieldValueTable)
    .values({ taskId, fieldId, value });
}

async function storedValue(taskId: string, fieldId: string) {
  const [row] = await db
    .select({ value: schema.customFieldValueTable.value })
    .from(schema.customFieldValueTable)
    .where(
      and(
        eq(schema.customFieldValueTable.taskId, taskId),
        eq(schema.customFieldValueTable.fieldId, fieldId),
      ),
    );
  return row?.value ?? null;
}

const patch = (s: Scene, id: string, body: unknown) =>
  s.app.request(`/api/custom-field/${id}`, json("PATCH", body));

describe("editing a custom field", () => {
  it("renames the field and keeps its values", async () => {
    const s = await queryScene();
    const field = await createField(s);
    const task = await s.createTask();
    await setValue(task.id, field.id, "Beta");

    const response = await patch(s, field.id, { name: "  Phase " });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      name: "Phase",
      options: ["Alpha", "Beta", "Gamma"],
    });
    expect(await storedValue(task.id, field.id)).toBe("Beta");
  });

  it("moves every stored copy of a renamed option", async () => {
    const s = await queryScene();
    const field = await createField(s, { defaultValue: "Beta" });
    const other = await createField(s, { name: "Other" });
    const moved = await s.createTask();
    const kept = await s.createTask();
    await setValue(moved.id, field.id, "Beta");
    await setValue(moved.id, other.id, "Beta");
    await setValue(kept.id, field.id, "Alpha");

    const condition = {
      key: "customField",
      fieldId: field.id,
      operator: "in",
      values: ["Beta", "Alpha"],
    };
    const [view] = await db
      .insert(schema.savedViewTable)
      .values({
        workspaceId: s.workspaceId,
        projectId: s.project.id,
        name: "Betas",
        createdBy: s.owner.id,
        filters: { version: 1, root: condition, archived: "exclude" },
      } as typeof schema.savedViewTable.$inferInsert)
      .returning();
    const [rule] = await db
      .insert(automationRuleTable)
      .values({
        projectId: s.project.id,
        name: "On beta",
        triggerType: "task_created",
        trigger: { type: "task_created" },
        conditions: {
          op: "and",
          conditions: [
            {
              field: "custom_field",
              fieldId: field.id,
              op: "equals",
              value: "Beta",
            },
            {
              field: "custom_field",
              fieldId: other.id,
              op: "equals",
              value: "Beta",
            },
          ],
        },
        actions: [],
      } as typeof automationRuleTable.$inferInsert)
      .returning();
    const [draft] = await db
      .insert(schema.taskDraftTable)
      .values({
        workspaceId: s.workspaceId,
        projectId: s.project.id,
        createdBy: s.owner.id,
        customFieldValues: [{ fieldId: field.id, value: "Beta" }],
      })
      .returning();

    const response = await patch(s, field.id, {
      options: ["Alpha", "Bravo", "Gamma"],
      renamedOptions: [{ from: "Beta", to: "Bravo" }],
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      options: ["Alpha", "Bravo", "Gamma"],
      defaultValue: "Bravo",
    });
    expect(await storedValue(moved.id, field.id)).toBe("Bravo");
    expect(await storedValue(kept.id, field.id)).toBe("Alpha");
    // Another field's identical text is not touched.
    expect(await storedValue(moved.id, other.id)).toBe("Beta");

    const [savedView] = await db
      .select({ filters: schema.savedViewTable.filters })
      .from(schema.savedViewTable)
      .where(eq(schema.savedViewTable.id, view?.id ?? ""));
    expect(savedView?.filters).toMatchObject({
      root: { values: ["Bravo", "Alpha"] },
    });

    const [savedRule] = await db
      .select({ conditions: automationRuleTable.conditions })
      .from(automationRuleTable)
      .where(eq(automationRuleTable.id, rule?.id ?? ""));
    expect(savedRule?.conditions).toMatchObject({
      conditions: [{ value: "Bravo" }, { value: "Beta" }],
    });

    const [savedDraft] = await db
      .select({ values: schema.taskDraftTable.customFieldValues })
      .from(schema.taskDraftTable)
      .where(eq(schema.taskDraftTable.id, draft?.id ?? ""));
    expect(savedDraft?.values).toEqual([{ fieldId: field.id, value: "Bravo" }]);
  });

  it("swaps two options without mixing up their tasks", async () => {
    const s = await queryScene();
    const field = await createField(s);
    const alpha = await s.createTask();
    const beta = await s.createTask();
    await setValue(alpha.id, field.id, "Alpha");
    await setValue(beta.id, field.id, "Beta");

    const response = await patch(s, field.id, {
      options: ["Beta", "Alpha", "Gamma"],
      renamedOptions: [
        { from: "Alpha", to: "Beta" },
        { from: "Beta", to: "Alpha" },
      ],
    });

    expect(response.status).toBe(200);
    expect(await storedValue(alpha.id, field.id)).toBe("Beta");
    expect(await storedValue(beta.id, field.id)).toBe("Alpha");
  });

  it("keeps a removed option on tasks, but refuses it on new ones", async () => {
    const s = await queryScene();
    const field = await createField(s);
    const holder = await s.createTask();
    const fresh = await s.createTask();
    await setValue(holder.id, field.id, "Beta");

    const response = await patch(s, field.id, { options: ["Alpha", "Gamma"] });
    expect(response.status).toBe(200);
    expect(await storedValue(holder.id, field.id)).toBe("Beta");

    const set = (taskId: string, value: string) =>
      s.app.request(
        "/api/custom-field/value",
        json("PUT", { taskId, fieldId: field.id, value }),
      );
    expect((await set(fresh.id, "Beta")).status).toBe(400);
    expect((await set(holder.id, "Beta")).status).toBe(200);
    expect((await set(holder.id, "Alpha")).status).toBe(200);
    // Once changed, the removed option is gone for this task too.
    expect((await set(holder.id, "Beta")).status).toBe(400);
  });

  it("keeps a filter already set on a removed option matching", async () => {
    const s = await queryScene();
    const field = await createField(s);
    const holder = await s.createTask();
    await s.createTask();
    await setValue(holder.id, field.id, "Beta");
    const filter = {
      key: "customField",
      operator: "in",
      fieldId: field.id,
      values: ["Beta"],
    };
    expect(await s.ids(filter)).toEqual([holder.id]);

    // The Filter menu stops offering Beta; a saved filter on it still works.
    await patch(s, field.id, { options: ["Alpha", "Gamma"] });
    expect(await s.ids(filter)).toEqual([holder.id]);
  });

  it("refuses a default the new options no longer include", async () => {
    const s = await queryScene();
    const field = await createField(s, { defaultValue: "Beta" });

    const response = await patch(s, field.id, { options: ["Alpha", "Gamma"] });

    expect(response.status).toBe(400);
    const [unchanged] = await db
      .select()
      .from(schema.customFieldDefinitionTable)
      .where(eq(schema.customFieldDefinitionTable.id, field.id));
    expect(unchanged?.options).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("refuses edits that would reinterpret values", async () => {
    const s = await queryScene();
    const field = await createField(s);
    const text = await createField(s, {
      name: "Notes",
      type: "text",
      options: null,
    });

    expect((await patch(s, field.id, { type: "text" })).status).toBe(400);
    expect((await patch(s, text.id, { options: ["a"] })).status).toBe(400);
    expect((await patch(s, field.id, { name: "  " })).status).toBe(400);
    expect(
      (await patch(s, field.id, { options: ["Alpha", "Alpha"] })).status,
    ).toBe(400);
  });

  it("needs project:update and stays inside the workspace", async () => {
    const s = await queryScene();
    const field = await createField(s);

    mockAuthenticatedSession(s.viewer);
    expect((await patch(s, field.id, { name: "Nope" })).status).toBe(403);
    mockAuthenticatedSession(s.ben);
    expect((await patch(s, field.id, { name: "Nope" })).status).toBe(403);

    const [unchanged] = await db
      .select({ name: schema.customFieldDefinitionTable.name })
      .from(schema.customFieldDefinitionTable)
      .where(eq(schema.customFieldDefinitionTable.id, field.id));
    expect(unchanged?.name).toBe("Stage");
  });
});

describe("setting a custom field on many tasks", () => {
  const bulk = (s: Scene, body: unknown) =>
    s.app.request("/api/custom-field/value/bulk", json("PUT", body));

  it("sets and clears a value across tasks", async () => {
    const s = await queryScene();
    const field = await createField(s);
    const first = await s.createTask();
    const second = await s.createTask();
    await setValue(first.id, field.id, "Alpha");

    const response = await bulk(s, {
      taskIds: [first.id, second.id],
      fieldId: field.id,
      value: "Gamma",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updatedCount: 2 });
    expect(await storedValue(first.id, field.id)).toBe("Gamma");
    expect(await storedValue(second.id, field.id)).toBe("Gamma");

    const cleared = await bulk(s, {
      taskIds: [first.id, second.id],
      fieldId: field.id,
      value: "",
    });
    expect(cleared.status).toBe(200);
    expect(await storedValue(first.id, field.id)).toBe("");
  });

  it("refuses invalid values and tasks of another project", async () => {
    const s = await queryScene();
    const field = await createField(s);
    const required = await createField(s, {
      name: "Must",
      required: true,
      defaultValue: "Alpha",
    });
    const task = await s.createTask();
    const otherProject = await s.createProject("other");
    const foreign = await s.createTask({ projectId: otherProject.id });

    const send = (body: Record<string, unknown>) =>
      bulk(s, { taskIds: [task.id], fieldId: field.id, ...body });
    expect((await send({ value: "Nope" })).status).toBe(400);
    expect((await send({ fieldId: required.id, value: "" })).status).toBe(400);
    expect(
      (await send({ taskIds: [task.id, foreign.id], value: "Alpha" })).status,
    ).toBe(400);
    expect(await storedValue(task.id, field.id)).toBeNull();
  });

  it("needs task:update", async () => {
    const s = await queryScene();
    const field = await createField(s);
    const task = await s.createTask();

    mockAuthenticatedSession(s.viewer);
    const response = await bulk(s, {
      taskIds: [task.id],
      fieldId: field.id,
      value: "Alpha",
    });
    expect(response.status).toBe(403);
    expect(await storedValue(task.id, field.id)).toBeNull();
  });
});

describe("grouping and sorting by a custom field", () => {
  it("groups a dropdown in option order, with no value and removed options last", async () => {
    const s = await queryScene();
    const field = await createField(s);
    const gamma = await s.createTask();
    const alpha = await s.createTask();
    const retired = await s.createTask();
    const blank = await s.createTask();
    const empty = await s.createTask();
    await setValue(gamma.id, field.id, "Gamma");
    await setValue(alpha.id, field.id, "Alpha");
    await setValue(retired.id, field.id, "Retired");
    await setValue(empty.id, field.id, "");

    const key = `customField:${field.id}`;
    const result = await s.query({
      scope: { projectIds: [s.project.id] },
      display: { groupBy: key },
    });

    expect(result.groupBy).toBe(key);
    expect(result.groups.map((group) => group.key)).toEqual([
      "value:Alpha",
      "value:Gamma",
      "value:Retired",
      "none",
    ]);
    expect(idsByGroup(result)["value:Alpha"]).toEqual([alpha.id]);
    expect(idsByGroup(result).none?.sort()).toEqual(
      [blank.id, empty.id].sort(),
    );
    expect(countsByGroup(result)["value:Retired"]).toBe(1);
    // Headers name the field without the caller asking for its values.
    expect(result.meta.customFields).toMatchObject([
      { id: field.id, name: "Stage", type: "dropdown" },
    ]);
  });

  it("keeps a value spelled none apart from tasks with no value", async () => {
    const s = await queryScene();
    const field = await createField(s, {
      name: "Note",
      type: "text",
      options: null,
    });
    const literal = await s.createTask();
    const blank = await s.createTask();
    await setValue(literal.id, field.id, "none");

    const result = await s.query({
      scope: { projectIds: [s.project.id] },
      display: { groupBy: `customField:${field.id}` },
    });

    expect(idsByGroup(result)).toEqual({
      "value:none": [literal.id],
      none: [blank.id],
    });
  });

  it("pages a custom field group and offers its empty options", async () => {
    const s = await queryScene();
    const field = await createField(s);
    const tasks = [await s.createTask(), await s.createTask()];
    for (const task of tasks) await setValue(task.id, field.id, "Beta");

    const body = {
      scope: { projectIds: [s.project.id] },
      display: {
        groupBy: `customField:${field.id}`,
        showEmptyGroups: true,
      },
    };
    const first = await s.query({ ...body, page: { limit: 1 } });
    expect(first.groups.map((group) => group.key)).toEqual([
      "value:Alpha",
      "value:Beta",
      "value:Gamma",
    ]);
    const beta = first.groups.find((group) => group.key === "value:Beta");
    expect(beta?.count).toBe(2);
    expect(beta?.nextCursor).toBeTruthy();

    const next = await s.query({
      ...body,
      page: {
        limit: 1,
        group: "value:Beta",
        cursor: beta?.nextCursor ?? undefined,
      },
    });
    expect(next.groups[0]?.taskIds).toHaveLength(1);
    expect(next.groups[0]?.taskIds?.[0]).not.toBe(beta?.taskIds?.[0]);
  });

  it("sorts numbers by value, with no value last either way", async () => {
    const s = await queryScene();
    const field = await createField(s, {
      name: "Score",
      type: "number",
      options: null,
    });
    const nine = await s.createTask();
    const ten = await s.createTask();
    const minus = await s.createTask();
    const blank = await s.createTask();
    const junk = await s.createTask();
    await setValue(nine.id, field.id, "9");
    await setValue(ten.id, field.id, "10");
    await setValue(minus.id, field.id, "-1.5");
    await setValue(junk.id, field.id, "not a number");

    const order = async (direction: "asc" | "desc") =>
      orderedIds(
        await s.query({
          scope: { projectIds: [s.project.id] },
          display: {
            orderBy: { field: `customField:${field.id}`, direction },
          },
        }),
      );

    const ascending = await order("asc");
    expect(ascending.slice(0, 3)).toEqual([minus.id, nine.id, ten.id]);
    expect(ascending.slice(3).sort()).toEqual([blank.id, junk.id].sort());
    expect((await order("desc")).slice(0, 3)).toEqual([
      ten.id,
      nine.id,
      minus.id,
    ]);
  });

  it("sorts dropdowns by option order and text ignoring case", async () => {
    const s = await queryScene();
    const dropdown = await createField(s);
    const text = await createField(s, {
      name: "Note",
      type: "text",
      options: null,
    });
    const gamma = await s.createTask();
    const alpha = await s.createTask();
    await setValue(gamma.id, dropdown.id, "Gamma");
    await setValue(alpha.id, dropdown.id, "Alpha");
    await setValue(gamma.id, text.id, "apple");
    await setValue(alpha.id, text.id, "Banana");

    const sort = async (fieldId: string) =>
      orderedIds(
        await s.query({
          scope: { projectIds: [s.project.id] },
          display: { orderBy: { field: `customField:${fieldId}` } },
        }),
      );

    expect(await sort(dropdown.id)).toEqual([alpha.id, gamma.id]);
    expect(await sort(text.id)).toEqual([gamma.id, alpha.id]);
  });

  it("reads a deleted field as no value instead of failing the list", async () => {
    const s = await queryScene();
    const task = await s.createTask();

    const grouped = await s.query({
      scope: { projectIds: [s.project.id] },
      display: { groupBy: "customField:gone" },
    });
    expect(idsByGroup(grouped)).toEqual({ none: [task.id] });

    const sorted = await s.query({
      scope: { projectIds: [s.project.id] },
      display: { orderBy: { field: "customField:gone" } },
    });
    expect(orderedIds(sorted)).toEqual([task.id]);
  });

  it("shows nothing of another project's field", async () => {
    const s = await queryScene();
    const otherProject = await s.createProject("other");
    const foreign = await createField(s, { projectId: otherProject.id });
    const holder = await s.createTask({ projectId: otherProject.id });
    await setValue(holder.id, foreign.id, "Alpha");
    const task = await s.createTask();

    const result = await s.query({
      scope: { projectIds: [s.project.id] },
      display: { groupBy: `customField:${foreign.id}` },
    });

    expect(idsByGroup(result)).toEqual({ none: [task.id] });
  });

  it("refuses a malformed key", async () => {
    const s = await queryScene();
    const response = await s.request({
      display: { groupBy: "customField:a b; drop" },
    });
    expect(response.status).toBe(400);
  });

  it("saves a project view that groups by a field, and only there", async () => {
    const s = await queryScene();
    const field = await createField(s);
    const otherProject = await s.createProject("other");
    const foreign = await createField(s, { projectId: otherProject.id });

    const post = (projectId: string | null, fieldId: string) =>
      s.app.request(
        "/api/view",
        json("POST", {
          workspaceId: s.workspaceId,
          ...(projectId ? { projectId } : {}),
          name: "By field",
          display: {
            layout: "list",
            groupBy: `customField:${fieldId}`,
            orderBy: { field: `customField:${fieldId}`, direction: "desc" },
          },
        }),
      );

    const saved = await post(s.project.id, field.id);
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(await saved.json()).toMatchObject({
      display: {
        groupBy: `customField:${field.id}`,
        orderBy: { field: `customField:${field.id}`, direction: "desc" },
      },
    });
    expect((await post(s.project.id, foreign.id)).status).toBe(400);
    expect((await post(null, field.id)).status).toBe(400);
  });
});
