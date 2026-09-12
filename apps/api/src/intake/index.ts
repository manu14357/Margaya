import { apiRouter, type BaseVariables } from "../openapi";
import { hasWorkspacePermission } from "../utils/require-workspace-permission";
import { type IntakeItemRef, resolveIntakeVisibility } from "./access";
import { acceptIntakeItem } from "./controllers/accept-intake-item";
import { deleteIntakeItem } from "./controllers/delete-intake-item";
import {
  getIntakeItem,
  getIntakeItemByTask,
  getIntakeSummary,
  listIntakeItems,
} from "./controllers/read-intake";
import {
  declineIntakeItem,
  markIntakeItemDuplicate,
  reopenIntakeItem,
  snoozeIntakeItem,
  unsnoozeIntakeItem,
} from "./controllers/triage-intake-item";
import { updateIntakeItem } from "./controllers/update-intake-item";
import {
  acceptIntakeItemRoute,
  createIntakeItemRoute,
  declineIntakeItemRoute,
  deleteIntakeItemRoute,
  getIntakeItemByTaskRoute,
  getIntakeItemRoute,
  getIntakeSummaryRoute,
  listIntakeItemsRoute,
  markIntakeItemDuplicateRoute,
  reopenIntakeItemRoute,
  snoozeIntakeItemRoute,
  unsnoozeIntakeItemRoute,
  updateIntakeItemRoute,
} from "./routes";
import { submitIntakeItem } from "./service";
import "./subscribers";

type IntakeVariables = BaseVariables & {
  workspaceId: string;
  projectId: string;
  intakeItem: IntakeItemRef;
};

// Literal first segments (project, task) are registered before the item
// routes.
const intake = apiRouter<IntakeVariables>()
  .openapi(listIntakeItemsRoute, async (c) =>
    c.json(
      await listIntakeItems({
        projectId: c.req.valid("param").projectId,
        userId: c.get("userId"),
        visibility: await resolveIntakeVisibility(c),
        query: c.req.valid("query"),
      }),
      200,
    ),
  )
  .openapi(getIntakeSummaryRoute, async (c) =>
    c.json(await getIntakeSummary(c.req.valid("param").projectId), 200),
  )
  .openapi(createIntakeItemRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await submitIntakeItem({
        projectId: c.req.valid("param").projectId,
        submittedBy: c.get("userId"),
        title: body.title,
        description: body.description,
        priority: body.priority,
        source: c.get("apiKey") ? "api" : "in_app",
      }),
      200,
    );
  })
  .openapi(getIntakeItemByTaskRoute, async (c) =>
    c.json(
      await getIntakeItemByTask({
        taskId: c.req.valid("param").taskId,
        userId: c.get("userId"),
        visibility: await resolveIntakeVisibility(c),
      }),
      200,
    ),
  )
  .openapi(getIntakeItemRoute, async (c) =>
    c.json(
      await getIntakeItem({
        itemId: c.req.valid("param").id,
        userId: c.get("userId"),
        visibility: await resolveIntakeVisibility(c),
      }),
      200,
    ),
  )
  .openapi(updateIntakeItemRoute, async (c) =>
    c.json(
      await updateIntakeItem({
        itemId: c.req.valid("param").id,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        canUpdateTasks: await hasWorkspacePermission(c, { task: ["update"] }),
        canCreateIntake: await hasWorkspacePermission(c, {
          intake: ["create"],
        }),
        input: c.req.valid("json"),
      }),
      200,
    ),
  )
  .openapi(acceptIntakeItemRoute, async (c) =>
    c.json(
      await acceptIntakeItem({
        itemId: c.req.valid("param").id,
        projectId: c.get("projectId"),
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        status: c.req.valid("json").status,
      }),
      200,
    ),
  )
  .openapi(declineIntakeItemRoute, async (c) =>
    c.json(
      await declineIntakeItem({
        itemId: c.req.valid("param").id,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        note: c.req.valid("json").note,
      }),
      200,
    ),
  )
  .openapi(snoozeIntakeItemRoute, async (c) =>
    c.json(
      await snoozeIntakeItem({
        itemId: c.req.valid("param").id,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        until: c.req.valid("json").until,
      }),
      200,
    ),
  )
  .openapi(unsnoozeIntakeItemRoute, async (c) =>
    c.json(
      await unsnoozeIntakeItem({
        itemId: c.req.valid("param").id,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
      }),
      200,
    ),
  )
  .openapi(markIntakeItemDuplicateRoute, async (c) => {
    const body = c.req.valid("json");
    const item = c.get("intakeItem");
    return c.json(
      await markIntakeItemDuplicate({
        itemId: item.id,
        projectId: item.projectId,
        taskId: item.taskId,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        duplicateOfTaskId: body.duplicateOfTaskId,
        note: body.note,
      }),
      200,
    );
  })
  .openapi(reopenIntakeItemRoute, async (c) =>
    c.json(
      await reopenIntakeItem({
        itemId: c.req.valid("param").id,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
      }),
      200,
    ),
  )
  .openapi(deleteIntakeItemRoute, async (c) =>
    c.json(
      await deleteIntakeItem({
        itemId: c.req.valid("param").id,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        canDeleteTasks: await hasWorkspacePermission(c, { task: ["delete"] }),
        canCreateIntake: await hasWorkspacePermission(c, {
          intake: ["create"],
        }),
      }),
      200,
    ),
  );

export default intake;
