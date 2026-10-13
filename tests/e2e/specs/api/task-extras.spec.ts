import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  expectJson,
  expectStatus,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// What hangs off a task: relations and parents, web links, attachments,
// integration links, and custom fields.

type Relation = {
  id: string;
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
};
type TaskLink = {
  id: string;
  taskId: string;
  url: string;
  title: string | null;
  host: string;
};
type CustomField = {
  id: string;
  projectId: string;
  name: string;
  type: string;
  required: boolean;
  defaultValue: string | null;
  position: number;
};
type FieldValue = {
  id: string;
  taskId: string;
  fieldId: string;
  value: string | null;
};

let world: World;
let project: Project;
let other: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Extras");
  project = await createProject(world.as("owner"), world.workspace.id);
  other = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

test.describe("relations", () => {
  test(
    "link tasks, list the relations and remove one",
    covers("createTaskRelation", "getTaskRelations", "deleteTaskRelation"),
    async () => {
      const owner = world.as("owner");
      const member = world.as("member");
      const a = await createTask(owner, project.id);
      const b = await createTask(owner, project.id);
      const elsewhere = await createTask(owner, other.id);

      const blocks = await expectJson<Relation>(
        await member.post("/api/task-relation", {
          data: {
            sourceTaskId: a.id,
            targetTaskId: b.id,
            relationType: "blocks",
          },
        }),
      );
      expect(blocks).toMatchObject({
        sourceTaskId: a.id,
        targetTaskId: b.id,
        relationType: "blocks",
      });
      // Relations may cross projects of the workspace.
      const related = await expectJson<Relation>(
        await member.post("/api/task-relation", {
          data: {
            sourceTaskId: a.id,
            targetTaskId: elsewhere.id,
            relationType: "related",
          },
        }),
      );

      const listed = await expectJson<Relation[]>(
        await world.as("viewer").get(`/api/task-relation/${a.id}`),
      );
      expect(listed.map((relation) => relation.id).sort()).toEqual(
        [blocks.id, related.id].sort(),
      );
      const fromTarget = await expectJson<Relation[]>(
        await world.as("viewer").get(`/api/task-relation/${b.id}`),
      );
      expect(fromTarget.map((relation) => relation.id)).toEqual([blocks.id]);

      await expectStatus(
        await member.post("/api/task-relation", {
          data: {
            sourceTaskId: b.id,
            targetTaskId: a.id,
            relationType: "related",
          },
        }),
        409,
      );
      await expectStatus(
        await member.post("/api/task-relation", {
          data: {
            sourceTaskId: a.id,
            targetTaskId: a.id,
            relationType: "related",
          },
        }),
        400,
      );
      await expectStatus(
        await member.post("/api/task-relation", {
          data: {
            sourceTaskId: a.id,
            targetTaskId: b.id,
            relationType: "friends",
          },
        }),
        400,
      );
      await expectStatus(
        await world.as("viewer").post("/api/task-relation", {
          data: {
            sourceTaskId: a.id,
            targetTaskId: elsewhere.id,
            relationType: "duplicate",
          },
        }),
        403,
      );

      const deleted = await expectJson<Relation>(
        await member.delete(`/api/task-relation/${related.id}`),
      );
      expect(deleted.id).toBe(related.id);
      await expectStatus(
        await member.delete(`/api/task-relation/${related.id}`),
        404,
      );
    },
  );

  test("set, change and clear a parent", covers("setTaskParent"), async () => {
    const owner = world.as("owner");
    const member = world.as("member");
    const parent = await createTask(owner, project.id);
    const newParent = await createTask(owner, project.id);
    const child = await createTask(owner, project.id);
    const foreign = await createTask(owner, other.id);

    const set = await expectJson<{
      taskId: string;
      parent: { id: string } | null;
    }>(
      await member.put(`/api/task-relation/parent/${child.id}`, {
        data: { parentTaskId: parent.id },
      }),
    );
    expect(set.taskId).toBe(child.id);
    expect(set.parent?.id).toBe(parent.id);

    const changed = await expectJson<{ parent: { id: string } | null }>(
      await member.put(`/api/task-relation/parent/${child.id}`, {
        data: { parentTaskId: newParent.id },
      }),
    );
    expect(changed.parent?.id).toBe(newParent.id);
    const relations = await expectJson<Relation[]>(
      await member.get(`/api/task-relation/${child.id}`),
    );
    expect(
      relations.filter((relation) => relation.relationType === "subtask"),
    ).toHaveLength(1);

    // A parent must be in the same project, and not a subtask of the child.
    await expectStatus(
      await member.put(`/api/task-relation/parent/${child.id}`, {
        data: { parentTaskId: foreign.id },
      }),
      400,
    );
    await expectStatus(
      await member.put(`/api/task-relation/parent/${newParent.id}`, {
        data: { parentTaskId: child.id },
      }),
      400,
    );
    await expectStatus(
      await member.put(`/api/task-relation/parent/${child.id}`, {
        data: { parentTaskId: "e2e-unknown" },
      }),
      404,
    );

    const cleared = await expectJson<{ parent: unknown }>(
      await member.put(`/api/task-relation/parent/${child.id}`, {
        data: { parentTaskId: null },
      }),
    );
    expect(cleared.parent).toBeNull();
  });
});

test(
  "task web links",
  covers("listTaskLinks", "createTaskLink", "updateTaskLink", "deleteTaskLink"),
  async () => {
    const member = world.as("member");
    const task = await createTask(world.as("owner"), project.id);
    const link = await expectJson<TaskLink & { createdBy: { id: string } }>(
      await member.post(`/api/task-link/${task.id}`, {
        data: { url: "docs.example.com/design", title: "Design doc" },
      }),
    );
    expect(link).toMatchObject({
      taskId: task.id,
      url: "https://docs.example.com/design",
      host: "docs.example.com",
      title: "Design doc",
    });
    expect(link.createdBy.id).toBe(world.users.member.id);

    await expectStatus(
      await member.post(`/api/task-link/${task.id}`, {
        data: { url: "https://docs.example.com/design" },
      }),
      409,
    );
    await expectStatus(
      await member.post(`/api/task-link/${task.id}`, {
        data: { url: "javascript:alert(1)" },
      }),
      400,
    );
    await expectStatus(
      await world.as("viewer").post(`/api/task-link/${task.id}`, {
        data: { url: "https://example.org" },
      }),
      403,
    );

    const updated = await expectJson<TaskLink>(
      await member.patch(`/api/task-link/${task.id}/${link.id}`, {
        data: { url: "https://docs.example.com/design-v2", title: null },
      }),
    );
    expect(updated).toMatchObject({
      url: "https://docs.example.com/design-v2",
      title: null,
    });
    await expectStatus(
      await member.patch(`/api/task-link/${task.id}/${link.id}`, { data: {} }),
      400,
    );

    const listed = await expectJson<TaskLink[]>(
      await world.as("viewer").get(`/api/task-link/${task.id}`),
    );
    expect(listed.map((entry) => entry.id)).toEqual([link.id]);

    const deleted = await expectJson<{ id: string }>(
      await member.delete(`/api/task-link/${task.id}/${link.id}`),
    );
    expect(deleted.id).toBe(link.id);
    await expectStatus(
      await member.delete(`/api/task-link/${task.id}/${link.id}`),
      404,
    );
  },
);

test(
  "attachments: listing works; uploads need object storage",
  covers(
    "listTaskAttachments",
    "createTaskAttachmentUpload",
    "finalizeTaskAttachment",
    "deleteTaskAttachment",
  ),
  async () => {
    const member = world.as("member");
    const task = await createTask(world.as("owner"), project.id);
    expect(
      await expectJson<unknown[]>(
        await world.as("viewer").get(`/api/task-attachment/${task.id}`),
      ),
    ).toEqual([]);

    const upload = await member.post(`/api/task-attachment/${task.id}/upload`, {
      data: { filename: "notes.txt", contentType: "text/plain", size: 12 },
    });
    // The e2e API runs without S3 (allowlisted in coverage.spec.ts).
    test.skip(
      upload.status() === 200,
      "S3 storage is configured; happy path not written",
    );
    expect(await expectStatus(upload, 503)).toMatch(/not configured/i);
    await expectStatus(
      await member.post(`/api/task-attachment/${task.id}/finalize`, {
        data: {
          key: "x/notes.txt",
          filename: "notes.txt",
          contentType: "text/plain",
          size: 12,
        },
      }),
      [400, 503],
    );
    await expectStatus(
      await world.as("viewer").post(`/api/task-attachment/${task.id}/upload`, {
        data: { filename: "notes.txt", contentType: "text/plain", size: 12 },
      }),
      403,
    );
    await expectStatus(
      await member.post(`/api/task-attachment/${task.id}/upload`, {
        data: { filename: "", contentType: "text/plain", size: 12 },
      }),
      400,
    );
    await expectStatus(
      await member.delete(
        `/api/task-attachment/${task.id}/e2e-unknown-attachment`,
      ),
      404,
    );
  },
);

test(
  "integration links of a task",
  covers("getExternalLinksByTask"),
  async () => {
    const task = await createTask(world.as("owner"), project.id);
    const links = await expectJson<unknown[]>(
      await world.as("viewer").get(`/api/external-link/task/${task.id}`),
    );
    // Only GitHub or Gitea create these; a fresh task has none.
    expect(links).toEqual([]);
  },
);

test.describe("custom fields", () => {
  test(
    "define fields, set values, filter and reorder, then delete a field",
    covers(
      "createCustomField",
      "getCustomFieldsByProject",
      "setCustomFieldValue",
      "getCustomFieldValuesByTask",
      "getCustomFieldValuesByProject",
      "getCustomFieldFilterValues",
      "reorderCustomFields",
      "deleteCustomField",
    ),
    async () => {
      const admin = world.as("admin");
      const member = world.as("member");
      const text = await expectJson<CustomField>(
        await admin.post("/api/custom-field", {
          data: {
            projectId: project.id,
            name: uniqueName("Customer"),
            type: "text",
          },
        }),
      );
      const dropdown = await expectJson<CustomField & { options: string[] }>(
        await admin.post("/api/custom-field", {
          data: {
            projectId: project.id,
            name: uniqueName("Tier"),
            type: "dropdown",
            options: ["Gold", "Silver"],
            defaultValue: "Silver",
          },
        }),
      );
      expect(dropdown).toMatchObject({
        type: "dropdown",
        defaultValue: "Silver",
      });

      const fields = await expectJson<CustomField[]>(
        await world.as("viewer").get(`/api/custom-field/project/${project.id}`),
      );
      expect(fields.map((field) => field.id)).toEqual([text.id, dropdown.id]);

      const task = await createTask(world.as("owner"), project.id);
      const saved = await expectJson<FieldValue>(
        await member.put("/api/custom-field/value", {
          data: { taskId: task.id, fieldId: text.id, value: "Acme" },
        }),
      );
      expect(saved).toMatchObject({
        taskId: task.id,
        fieldId: text.id,
        value: "Acme",
      });
      await expectJson(
        await member.put("/api/custom-field/value", {
          data: { taskId: task.id, fieldId: dropdown.id, value: "Gold" },
        }),
      );

      const taskValues = await expectJson<
        (FieldValue & { fieldName: string })[]
      >(await world.as("viewer").get(`/api/custom-field/task/${task.id}`));
      expect(taskValues.map((value) => [value.fieldId, value.value])).toEqual(
        expect.arrayContaining([
          [text.id, "Acme"],
          [dropdown.id, "Gold"],
        ]),
      );
      const projectValues = await expectJson<FieldValue[]>(
        await world
          .as("viewer")
          .get(`/api/custom-field/project/${project.id}/values`),
      );
      expect(
        projectValues.filter((value) => value.taskId === task.id),
      ).toHaveLength(2);
      const filters = await expectJson<{ fieldId: string; values: string[] }[]>(
        await world
          .as("viewer")
          .get(`/api/custom-field/project/${project.id}/filter-values`),
      );
      expect(
        filters.find((filter) => filter.fieldId === text.id)?.values,
      ).toEqual(["Acme"]);

      await expectJson(
        await admin.put(`/api/custom-field/reorder/${project.id}`, {
          data: {
            fields: [
              { id: dropdown.id, position: 0 },
              { id: text.id, position: 1 },
            ],
          },
        }),
      );
      const reordered = await expectJson<CustomField[]>(
        await admin.get(`/api/custom-field/project/${project.id}`),
      );
      expect(reordered.map((field) => field.id)).toEqual([
        dropdown.id,
        text.id,
      ]);

      // Members lack project:update for definitions; viewers cannot set values.
      await expectStatus(
        await member.post("/api/custom-field", {
          data: { projectId: project.id, name: "Member field", type: "text" },
        }),
        403,
      );
      await expectStatus(
        await world.as("viewer").put("/api/custom-field/value", {
          data: { taskId: task.id, fieldId: text.id, value: "Nope" },
        }),
        403,
      );
      await expectStatus(
        await admin.post("/api/custom-field", {
          data: { projectId: project.id, name: "Bad", type: "color" },
        }),
        400,
      );
      await expectStatus(
        await admin.put(`/api/custom-field/reorder/${other.id}`, {
          data: { fields: [{ id: text.id, position: 0 }] },
        }),
        400,
      );

      const deleted = await expectJson<CustomField>(
        await admin.delete(`/api/custom-field/${text.id}`),
      );
      expect(deleted.id).toBe(text.id);
      const remaining = await expectJson<CustomField[]>(
        await admin.get(`/api/custom-field/project/${project.id}`),
      );
      expect(remaining.map((field) => field.id)).toEqual([dropdown.id]);
      await expectStatus(
        await member.delete(`/api/custom-field/${dropdown.id}`),
        403,
      );
    },
  );
});
