import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { shiftDate, todayUtc } from "../../apps/api/src/utils/calendar-date";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import { queryScene, sorted } from "./helpers/task-query";

const inValues = (key: string, values: string[]) => ({
  key,
  operator: "in",
  values,
});
const notIn = (key: string, values: string[]) => ({
  key,
  operator: "notIn",
  values,
});

describe("API integration: task query filters", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("filters by status and group, with planned in backlog", async () => {
    const s = await queryScene();
    const todo = await s.createTask({ status: "to-do" });
    const doing = await s.createTask({ status: "in-progress" });
    const done = await s.createTask({ status: "done" });
    const planned = await s.createTask({ status: "planned" });

    expect(await s.ids(inValues("status", ["to-do", "planned"]))).toEqual(
      sorted([todo.id, planned.id]),
    );
    expect(await s.ids(notIn("status", ["to-do"]))).toEqual(
      sorted([doing.id, done.id, planned.id]),
    );
    expect(await s.ids(inValues("group", ["backlog"]))).toEqual([planned.id]);
    expect(await s.ids(inValues("group", ["started", "completed"]))).toEqual(
      sorted([doing.id, done.id]),
    );
    // Every task has a group, so `none` matches nothing.
    expect(await s.ids(inValues("group", ["none"]))).toEqual([]);
    expect(await s.ids(notIn("group", ["unstarted", "none"]))).toEqual(
      sorted([doing.id, done.id, planned.id]),
    );
  });

  it("filters by priority", async () => {
    const s = await queryScene();
    const urgent = await s.createTask({ priority: "urgent" });
    const low = await s.createTask({ priority: "low" });
    const none = await s.createTask({ priority: "no-priority" });

    expect(await s.ids(inValues("priority", ["urgent", "low"]))).toEqual(
      sorted([urgent.id, low.id]),
    );
    expect(await s.ids(notIn("priority", ["urgent"]))).toEqual(
      sorted([low.id, none.id]),
    );
    await s.refuse(
      { filters: inValues("priority", ["highest"]) },
      400,
      "Unsupported value for priority: highest",
    );
  });

  it("treats assignees as a set: any of, none of, none, me", async () => {
    const s = await queryScene();
    const shared = await s.createTask({ assignees: [s.owner.id, s.ben.id] });
    const bens = await s.createTask({ assignees: [s.ben.id] });
    const unassigned = await s.createTask();
    const caras = await s.createTask({ assignees: [s.cara.id] });

    expect(await s.ids(inValues("assignee", ["me"]))).toEqual([shared.id]);
    expect(await s.ids(inValues("assignee", [s.ben.id]))).toEqual(
      sorted([shared.id, bens.id]),
    );
    // "Is none of Ben" keeps unassigned tasks.
    expect(await s.ids(notIn("assignee", [s.ben.id]))).toEqual(
      sorted([unassigned.id, caras.id]),
    );
    expect(await s.ids(inValues("assignee", ["none"]))).toEqual([
      unassigned.id,
    ]);
    expect(await s.ids(inValues("assignee", [s.cara.id, "none"]))).toEqual(
      sorted([unassigned.id, caras.id]),
    );
    expect(await s.ids(notIn("assignee", [s.cara.id, "none"]))).toEqual(
      sorted([shared.id, bens.id]),
    );
    // Unknown ids match nothing and exclude nothing.
    expect(await s.ids(inValues("assignee", ["user-gone"]))).toEqual([]);
    expect(await s.ids(notIn("assignee", ["user-gone"]))).toHaveLength(4);
    // `me` is whoever asks.
    expect(await s.ids(inValues("assignee", ["me"]), {}, s.ben)).toEqual(
      sorted([shared.id, bens.id]),
    );
  });

  it("filters by creator with me and none", async () => {
    const s = await queryScene();
    const mine = await s.createTask({ createdBy: s.owner.id });
    const bens = await s.createTask({ createdBy: s.ben.id });
    const external = await s.createTask({ createdBy: null });

    expect(await s.ids(inValues("createdBy", ["me"]))).toEqual([mine.id]);
    expect(await s.ids(inValues("createdBy", ["none"]))).toEqual([external.id]);
    expect(await s.ids(notIn("createdBy", ["me"]))).toEqual(
      sorted([bens.id, external.id]),
    );
    expect(await s.ids(notIn("createdBy", ["me", "none"]))).toEqual([bens.id]);
  });

  it("matches labels by name, through workspace label ids and name literals", async () => {
    const s = await queryScene();
    const bug = await s.workspaceLabel("Bug");
    await s.workspaceLabel("UI");
    const both = await s.createTask({ labels: ["Bug", "UI"] });
    const ui = await s.createTask({ labels: ["UI"] });
    const bare = await s.createTask();
    const legacy = await s.createTask({ labels: ["Legacy"] });

    expect(await s.ids(inValues("label", [bug.id]))).toEqual([both.id]);
    expect(await s.ids(inValues("label", ["name:Legacy"]))).toEqual([
      legacy.id,
    ]);
    expect(await s.ids(inValues("label", ["name:UI"]))).toEqual(
      sorted([both.id, ui.id]),
    );
    expect(await s.ids(notIn("label", [bug.id]))).toEqual(
      sorted([ui.id, bare.id, legacy.id]),
    );
    expect(await s.ids(inValues("label", ["none"]))).toEqual([bare.id]);
    expect(await s.ids(notIn("label", ["name:UI", "none"]))).toEqual([
      legacy.id,
    ]);

    // A rename reaches the copies too, and the stored id keeps matching.
    await db
      .update(schema.labelTable)
      .set({ name: "Defect" })
      .where(eq(schema.labelTable.name, "Bug"));
    expect(await s.ids(inValues("label", [bug.id]))).toEqual([both.id]);

    // Another workspace's label id resolves to nothing.
    const other = await createWorkspaceMember();
    const [foreign] = await db
      .insert(schema.labelTable)
      .values({ name: "UI", color: "#000", workspaceId: other.workspace.id })
      .returning();
    expect(await s.ids(inValues("label", [foreign?.id ?? ""]))).toEqual([]);
  });

  it("filters by cycle, current cycle and none; cycles off reads as none", async () => {
    const s = await queryScene();
    const today = todayUtc();
    const [current] = await db
      .insert(schema.cycleTable)
      .values({
        projectId: s.project.id,
        name: "Now",
        startDate: shiftDate(today, -2),
        endDate: shiftDate(today, 2),
      })
      .returning();
    const [upcoming] = await db
      .insert(schema.cycleTable)
      .values({
        projectId: s.project.id,
        name: "Next",
        startDate: shiftDate(today, 10),
        endDate: shiftDate(today, 20),
      })
      .returning();
    if (!current || !upcoming) throw new Error("cycles");
    const inCurrent = await s.createTask();
    const inUpcoming = await s.createTask();
    const outside = await s.createTask();
    await db.insert(schema.cycleTaskTable).values([
      { taskId: inCurrent.id, cycleId: current.id },
      { taskId: inUpcoming.id, cycleId: upcoming.id },
    ]);

    expect(await s.ids(inValues("cycle", ["current"]))).toEqual([inCurrent.id]);
    expect(await s.ids(inValues("cycle", [upcoming.id]))).toEqual([
      inUpcoming.id,
    ]);
    expect(await s.ids(inValues("cycle", ["none"]))).toEqual([outside.id]);
    expect(await s.ids(notIn("cycle", ["current"]))).toEqual(
      sorted([inUpcoming.id, outside.id]),
    );

    await s.setFeatures(s.project.id, { cyclesEnabled: false });
    expect(await s.ids(inValues("cycle", ["current", upcoming.id]))).toEqual(
      [],
    );
    expect(await s.ids(inValues("cycle", ["none"]))).toHaveLength(3);
  });

  it("filters by active modules only; modules off reads as none", async () => {
    const s = await queryScene();
    const [active, archived] = await db
      .insert(schema.moduleTable)
      .values([
        { projectId: s.project.id, name: "Active" },
        { projectId: s.project.id, name: "Old", archivedAt: new Date() },
      ])
      .returning();
    if (!active || !archived) throw new Error("modules");
    const inBoth = await s.createTask();
    const inArchived = await s.createTask();
    const outside = await s.createTask();
    await db.insert(schema.moduleTaskTable).values([
      { moduleId: active.id, taskId: inBoth.id },
      { moduleId: archived.id, taskId: inBoth.id },
      { moduleId: archived.id, taskId: inArchived.id },
    ]);

    expect(await s.ids(inValues("module", [active.id]))).toEqual([inBoth.id]);
    expect(await s.ids(inValues("module", [archived.id]))).toEqual([]);
    expect(await s.ids(inValues("module", ["none"]))).toEqual(
      sorted([inArchived.id, outside.id]),
    );
    expect(await s.ids(notIn("module", [active.id, "none"]))).toEqual([]);

    await s.setFeatures(s.project.id, { modulesEnabled: false });
    expect(await s.ids(inValues("module", [active.id]))).toEqual([]);
    expect(await s.ids(inValues("module", ["none"]))).toHaveLength(3);
  });

  it("filters by estimate point; estimates off reads as none", async () => {
    const s = await queryScene();
    await s.setFeatures(s.project.id, { estimatesEnabled: true });
    const [system] = await db
      .insert(schema.estimateTable)
      .values({
        projectId: s.project.id,
        name: "Points",
        type: "points",
        isActive: true,
      })
      .returning();
    if (!system) throw new Error("estimate");
    const [one, two] = await db
      .insert(schema.estimatePointTable)
      .values([
        { estimateId: system.id, value: "1", numericValue: 1, position: 1 },
        { estimateId: system.id, value: "2", numericValue: 2, position: 2 },
      ])
      .returning();
    if (!one || !two) throw new Error("points");
    const small = await s.createTask({ estimatePointId: one.id });
    const bigger = await s.createTask({ estimatePointId: two.id });
    const none = await s.createTask();

    expect(await s.ids(inValues("estimate", [one.id]))).toEqual([small.id]);
    expect(await s.ids(inValues("estimate", ["none"]))).toEqual([none.id]);
    expect(await s.ids(notIn("estimate", [one.id]))).toEqual(
      sorted([bigger.id, none.id]),
    );

    await s.setFeatures(s.project.id, { estimatesEnabled: false });
    expect(await s.ids(inValues("estimate", [one.id]))).toEqual([]);
    expect(await s.ids(inValues("estimate", ["none"]))).toHaveLength(3);
  });

  it("filters by project across the workspace", async () => {
    const s = await queryScene();
    const api = await s.createProject("api");
    const web = await s.createTask();
    const apiTask = await s.createTask({ projectId: api.id });

    expect(await s.ids(inValues("project", [api.id]))).toEqual([apiTask.id]);
    expect(await s.ids(notIn("project", [api.id]))).toEqual([web.id]);
    expect(await s.ids(null, { scope: { projectIds: [api.id] } })).toEqual([
      apiTask.id,
    ]);
  });

  it("filters by parent; none gives top-level tasks", async () => {
    const s = await queryScene();
    const parent = await s.createTask();
    const first = await s.createTask();
    const second = await s.createTask();
    const alone = await s.createTask();
    await db.insert(schema.taskRelationTable).values([
      {
        sourceTaskId: parent.id,
        targetTaskId: first.id,
        relationType: "subtask",
      },
      {
        sourceTaskId: parent.id,
        targetTaskId: second.id,
        relationType: "subtask",
      },
      {
        sourceTaskId: alone.id,
        targetTaskId: parent.id,
        relationType: "blocks",
      },
    ]);

    expect(await s.ids(inValues("parent", [parent.id]))).toEqual(
      sorted([first.id, second.id]),
    );
    expect(await s.ids(inValues("parent", ["none"]))).toEqual(
      sorted([parent.id, alone.id]),
    );
    expect(await s.ids(notIn("parent", ["none"]))).toEqual(
      sorted([first.id, second.id]),
    );
    expect(await s.ids(null, { display: { showSubTasks: false } })).toEqual(
      sorted([parent.id, alone.id]),
    );
  });

  it("filters by custom field values; empty counts as none", async () => {
    const s = await queryScene();
    const [field] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({
        projectId: s.project.id,
        name: "Impact",
        type: "dropdown",
        options: ["High", "Low"],
      })
      .returning();
    if (!field) throw new Error("field");
    const high = await s.createTask();
    const blank = await s.createTask();
    const missing = await s.createTask();
    const low = await s.createTask();
    await db.insert(schema.customFieldValueTable).values([
      { taskId: high.id, fieldId: field.id, value: "High" },
      { taskId: blank.id, fieldId: field.id, value: "" },
      { taskId: low.id, fieldId: field.id, value: "Low" },
    ]);
    const condition = (operator: string, values: string[]) => ({
      key: "customField",
      operator,
      values,
      fieldId: field.id,
    });

    expect(await s.ids(condition("in", ["High"]))).toEqual([high.id]);
    expect(await s.ids(condition("in", ["none"]))).toEqual(
      sorted([blank.id, missing.id]),
    );
    expect(await s.ids(condition("notIn", ["High"]))).toEqual(
      sorted([blank.id, missing.id, low.id]),
    );
    expect(await s.ids(condition("notIn", ["High", "none"]))).toEqual([low.id]);

    await s.refuse(
      { filters: { ...condition("in", ["High"]), fieldId: "field-unknown" } },
      400,
      "Unknown custom field",
    );
    const other = await createWorkspaceMember();
    const [foreignProject] = await db
      .insert(schema.projectTable)
      .values({ workspaceId: other.workspace.id, name: "X", slug: "x" })
      .returning();
    const [foreignField] = await db
      .insert(schema.customFieldDefinitionTable)
      .values({
        projectId: foreignProject?.id ?? "",
        name: "Secret",
        type: "text",
      })
      .returning();
    await s.refuse(
      {
        filters: { ...condition("in", ["x"]), fieldId: foreignField?.id },
      },
      400,
      "Unknown custom field",
    );
  });

  it("combines conditions with and / or groups up to three levels", async () => {
    const s = await queryScene();
    const urgentMine = await s.createTask({
      priority: "urgent",
      assignees: [s.owner.id],
    });
    const urgentBens = await s.createTask({
      priority: "urgent",
      assignees: [s.ben.id],
    });
    const lowMine = await s.createTask({
      priority: "low",
      assignees: [s.owner.id],
    });
    await s.createTask({ priority: "low" });

    const urgent = inValues("priority", ["urgent"]);
    const mine = inValues("assignee", ["me"]);
    expect(await s.ids({ op: "and", children: [urgent, mine] })).toEqual([
      urgentMine.id,
    ]);
    expect(await s.ids({ op: "or", children: [urgent, mine] })).toEqual(
      sorted([urgentMine.id, urgentBens.id, lowMine.id]),
    );
    const nested = {
      op: "and",
      children: [
        {
          op: "or",
          children: [
            { op: "and", children: [urgent, inValues("assignee", [s.ben.id])] },
            inValues("priority", ["low"]),
          ],
        },
        notIn("assignee", ["none"]),
      ],
    };
    expect(await s.ids(nested)).toEqual(sorted([urgentBens.id, lowMine.id]));

    await s.refuse(
      {
        filters: {
          op: "and",
          children: [
            { op: "and", children: [{ op: "and", children: [nested] }] },
          ],
        },
      },
      400,
      "Filters are too complex: groups nest deeper than 3 levels",
    );
    await s.refuse(
      {
        filters: {
          op: "and",
          children: Array.from({ length: 3 }, () => ({
            op: "or",
            children: Array.from({ length: 17 }, () => urgent),
          })),
        },
      },
      400,
      "Filters are too complex: more than 50 conditions",
    );
    await s.refuse(
      { filters: inValues("colour", ["red"]) },
      400,
      "Unsupported filter: colour",
    );
    await s.refuse(
      { filters: inValues("watcher", ["me"]) },
      400,
      "Unsupported filter: watcher",
    );
    await s.refuse(
      { filters: { key: "priority", operator: "on", date: "2026-01-01" } },
      400,
      "Operator on is not valid for priority",
    );
  });

  it("never returns triage tasks", async () => {
    const s = await queryScene();
    await db.insert(schema.columnTable).values({
      projectId: s.project.id,
      name: "Triage",
      slug: "triage",
      position: 99,
      group: "triage",
    });
    const visible = await s.createTask();
    const triage = await s.createTask({ status: "triage" });

    expect(await s.ids(null)).toEqual([visible.id]);
    expect(await s.ids(null, { archived: "include" })).toEqual([visible.id]);
    expect(await s.ids(inValues("status", ["triage"]))).toEqual([]);
    expect(triage.id).not.toBe(visible.id);
  });

  it("filters by blocked: an open task an open task still blocks", async () => {
    const s = await queryScene();
    const relate = (
      sourceTaskId: string,
      targetTaskId: string,
      relationType = "blocks",
    ) =>
      db
        .insert(schema.taskRelationTable)
        .values({ sourceTaskId, targetTaskId, relationType });

    const blocker = await s.createTask();
    const blocked = await s.createTask();
    await relate(blocker.id, blocked.id);
    // In another project: the filter still counts it.
    const otherProject = await s.createProject("api");
    const blockerElsewhere = await s.createTask({ projectId: otherProject.id });
    const blockedAcross = await s.createTask();
    await relate(blockerElsewhere.id, blockedAcross.id);

    // Not blocked: the blocker is done, cancelled, archived or trashed; the
    // relation isn't `blocks`; or the task itself is already done.
    const done = await s.createTask({ status: "done" });
    const afterDone = await s.createTask();
    await relate(done.id, afterDone.id);
    await db.insert(schema.columnTable).values({
      projectId: s.project.id,
      name: "Won't do",
      slug: "wont-do",
      position: 9,
      group: "cancelled",
      isFinal: true,
    });
    const cancelled = await s.createTask({ status: "wont-do" });
    const afterCancelled = await s.createTask();
    await relate(cancelled.id, afterCancelled.id);
    const archived = await s.createTask({ archivedAt: new Date() });
    const afterArchived = await s.createTask();
    await relate(archived.id, afterArchived.id);
    const trashed = await s.createTask({ deletedAt: new Date() });
    const afterTrashed = await s.createTask();
    await relate(trashed.id, afterTrashed.id);
    const merelyRelated = await s.createTask();
    await relate(blocker.id, merelyRelated.id, "related");
    const finished = await s.createTask({ status: "done" });
    await relate(blocker.id, finished.id);

    const stillBlocked = sorted([blocked.id, blockedAcross.id]);
    const clear = sorted([
      blocker.id,
      blockerElsewhere.id,
      done.id,
      afterDone.id,
      cancelled.id,
      afterCancelled.id,
      afterArchived.id,
      afterTrashed.id,
      merelyRelated.id,
      finished.id,
    ]);

    expect(await s.ids(inValues("blocked", ["true"]))).toEqual(stillBlocked);
    expect(await s.ids(notIn("blocked", ["false"]))).toEqual(stillBlocked);
    expect(await s.ids(inValues("blocked", ["false"]))).toEqual(clear);
    expect(await s.ids(notIn("blocked", ["true"]))).toEqual(clear);
    expect(await s.ids(inValues("blocked", ["true", "false"]))).toEqual(
      sorted([...stillBlocked, ...clear]),
    );
    // Every task either is blocked or isn't, so `none` matches nothing.
    expect(await s.ids(inValues("blocked", ["none"]))).toEqual([]);
    await s.refuse(
      { filters: inValues("blocked", ["maybe"]) },
      400,
      "Unsupported value for blocked: maybe",
    );

    // Finishing the blocker clears it; nothing else had to change.
    await db
      .update(schema.taskTable)
      .set({ status: "done" })
      .where(eq(schema.taskTable.id, blocker.id));
    expect(await s.ids(inValues("blocked", ["true"]))).toEqual([
      blockedAcross.id,
    ]);
  });

  it("applies the archived rule: exclude, include, only", async () => {
    const s = await queryScene();
    const active = await s.createTask();
    const archived = await s.createTask({ archivedAt: new Date() });

    expect(await s.ids(null)).toEqual([active.id]);
    expect(await s.ids(null, { archived: "include" })).toEqual(
      sorted([active.id, archived.id]),
    );
    expect(await s.ids(null, { archived: "only" })).toEqual([archived.id]);
  });

  it("searches titles and task keys", async () => {
    const s = await queryScene();
    const login = await s.createTask({ title: "Fix the Login page" });
    const twelve = await s.createTask({ title: "Something", number: 12 });
    const percent = await s.createTask({ title: "Give 50% off" });
    await s.createTask({ title: "Give 500 off" });

    expect(await s.ids(null, { search: "login" })).toEqual([login.id]);
    expect(await s.ids(null, { search: "WEB-12" })).toEqual([twelve.id]);
    expect(await s.ids(null, { search: "web-12" })).toEqual([twelve.id]);
    expect(await s.ids(null, { search: "#12" })).toEqual([twelve.id]);
    expect(await s.ids(null, { search: "12" })).toEqual([twelve.id]);
    // % is literal, not a wildcard.
    expect(await s.ids(null, { search: "50%" })).toEqual([percent.id]);
  });
});
