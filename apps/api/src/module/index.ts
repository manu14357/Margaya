import { apiRouter, type BaseVariables } from "../openapi";
import { hasWorkspacePermission } from "../utils/require-workspace-permission";
import { archiveModule, unarchiveModule } from "./controllers/archive-module";
import createModule from "./controllers/create-module";
import deleteModule from "./controllers/delete-module";
import getModule from "./controllers/get-module";
import getModuleProgress from "./controllers/get-module-progress";
import listModuleTasks from "./controllers/list-module-tasks";
import listModules from "./controllers/list-modules";
import {
  createModuleLink,
  deleteModuleLink,
  listModuleLinks,
  updateModuleLink,
} from "./controllers/module-links";
import { addModuleTasks, removeModuleTasks } from "./controllers/module-tasks";
import reorderModules from "./controllers/reorder-modules";
import {
  getModuleTaskMap,
  getTaskModules,
  setTaskModules,
} from "./controllers/task-modules";
import updateModule from "./controllers/update-module";
import {
  addModuleTasksRoute,
  archiveModuleRoute,
  createModuleLinkRoute,
  deleteModuleLinkRoute,
  deleteModuleRoute,
  getModuleProgressRoute,
  getModuleRoute,
  listModuleLinksRoute,
  listModuleTasksRoute,
  removeModuleTasksRoute,
  unarchiveModuleRoute,
  updateModuleLinkRoute,
  updateModuleRoute,
} from "./module-routes";
import {
  createModuleRoute,
  getModuleTaskMapRoute,
  getTaskModulesRoute,
  listModulesRoute,
  reorderModulesRoute,
  setTaskModulesRoute,
} from "./routes";

type ModuleVariables = BaseVariables & {
  workspaceId: string;
  projectId: string;
};

// Literal first segments (project, task) are registered before the {id} routes.
const moduleRouter = apiRouter<ModuleVariables>()
  .openapi(listModulesRoute, async (c) =>
    c.json(
      await listModules(c.req.valid("param").projectId, c.req.valid("query")),
      200,
    ),
  )
  .openapi(createModuleRoute, async (c) =>
    c.json(
      await createModule({
        projectId: c.req.valid("param").projectId,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        input: c.req.valid("json"),
      }),
      200,
    ),
  )
  .openapi(reorderModulesRoute, async (c) =>
    c.json(
      await reorderModules({
        projectId: c.req.valid("param").projectId,
        userId: c.get("userId"),
        modules: c.req.valid("json").modules,
      }),
      200,
    ),
  )
  .openapi(getModuleTaskMapRoute, async (c) =>
    c.json(await getModuleTaskMap(c.req.valid("param").projectId), 200),
  )
  .openapi(getTaskModulesRoute, async (c) =>
    c.json(await getTaskModules(c.req.valid("param").taskId), 200),
  )
  .openapi(setTaskModulesRoute, async (c) =>
    c.json(
      await setTaskModules({
        taskId: c.req.valid("param").taskId,
        userId: c.get("userId"),
        ...c.req.valid("json"),
      }),
      200,
    ),
  )
  .openapi(getModuleRoute, async (c) =>
    c.json(await getModule(c.req.valid("param").id), 200),
  )
  .openapi(updateModuleRoute, async (c) =>
    c.json(
      await updateModule({
        moduleId: c.req.valid("param").id,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        input: c.req.valid("json"),
      }),
      200,
    ),
  )
  .openapi(deleteModuleRoute, async (c) =>
    c.json(
      await deleteModule({
        moduleId: c.req.valid("param").id,
        userId: c.get("userId"),
        canDeleteAnyModule: await hasWorkspacePermission(c, {
          module: ["delete"],
        }),
      }),
      200,
    ),
  )
  .openapi(archiveModuleRoute, async (c) =>
    c.json(await archiveModule(c.req.valid("param").id, c.get("userId")), 200),
  )
  .openapi(unarchiveModuleRoute, async (c) =>
    c.json(
      await unarchiveModule(c.req.valid("param").id, c.get("userId")),
      200,
    ),
  )
  .openapi(getModuleProgressRoute, async (c) =>
    c.json(
      await getModuleProgress(c.req.valid("param").id, c.get("workspaceId")),
      200,
    ),
  )
  .openapi(listModuleTasksRoute, async (c) =>
    c.json(
      await listModuleTasks(c.req.valid("param").id, c.req.valid("query")),
      200,
    ),
  )
  .openapi(addModuleTasksRoute, async (c) =>
    c.json(
      await addModuleTasks({
        moduleId: c.req.valid("param").id,
        userId: c.get("userId"),
        taskIds: c.req.valid("json").taskIds,
      }),
      200,
    ),
  )
  .openapi(removeModuleTasksRoute, async (c) =>
    c.json(
      await removeModuleTasks({
        moduleId: c.req.valid("param").id,
        userId: c.get("userId"),
        taskIds: c.req.valid("json").taskIds,
      }),
      200,
    ),
  )
  .openapi(listModuleLinksRoute, async (c) =>
    c.json(await listModuleLinks(c.req.valid("param").id), 200),
  )
  .openapi(createModuleLinkRoute, async (c) =>
    c.json(
      await createModuleLink({
        moduleId: c.req.valid("param").id,
        userId: c.get("userId"),
        ...c.req.valid("json"),
      }),
      200,
    ),
  )
  .openapi(updateModuleLinkRoute, async (c) =>
    c.json(
      await updateModuleLink({
        moduleId: c.req.valid("param").id,
        linkId: c.req.valid("param").linkId,
        userId: c.get("userId"),
        ...c.req.valid("json"),
      }),
      200,
    ),
  )
  .openapi(deleteModuleLinkRoute, async (c) =>
    c.json(
      await deleteModuleLink({
        moduleId: c.req.valid("param").id,
        linkId: c.req.valid("param").linkId,
        userId: c.get("userId"),
      }),
      200,
    ),
  );

export default moduleRouter;
