import { HTTPException } from "hono/http-exception";
import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  lookupNotFound,
  z,
} from "../openapi";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import projectAccessRoutes from "./access-routes";
import archiveProjectCtrl from "./controllers/archive-project";
import createProjectCtrl from "./controllers/create-project";
import deleteProjectCtrl from "./controllers/delete-project";
import getProjectCtrl from "./controllers/get-project";
import getProjectsCtrl from "./controllers/get-projects";
import reorderProjectsCtrl from "./controllers/reorder-projects";
import unarchiveProjectCtrl from "./controllers/unarchive-project";
import updateProjectCtrl from "./controllers/update-project";
import updateProjectFeaturesCtrl from "./controllers/update-project-features";
import { projectListSchema, projectSchema } from "./response";
import {
  createProjectBody,
  listProjectsQuery,
  projectParam,
  reorderProjectsBody,
  updateProjectBody,
  updateProjectFeaturesBody,
  workspaceIdQuery,
} from "./schema";
import { assertProjectVisible, requestHiddenProjectIds } from "./visibility";

const listProjectsRoute = createRoute({
  method: "get",
  operationId: "listProjects",
  path: "/",
  tags: ["Projects"],
  summary: "List projects",
  description:
    "List a workspace's projects in sidebar order, each with rollup task statistics. Archived projects are excluded unless includeArchived is set.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: listProjectsQuery },
  responses: {
    200: jsonResponse("List of projects", projectListSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
  },
});

const createProjectRoute = createRoute({
  method: "post",
  operationId: "createProject",
  path: "/",
  tags: ["Projects"],
  summary: "Create project",
  description:
    "Create a project in a workspace. The slug becomes the prefix of its task identifiers and must be unique in the workspace, ignoring case. New projects start with cycles, modules, views, pages and time tracking turned on. With fromProjectId the project starts from another project's setup instead (and optionally its task templates and open tasks); no tasks are copied unless copy.openTasks is true.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspacePermission({ project: ["create"] }),
    requireEntitlement,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createProjectBody } },
    },
  },
  responses: {
    200: jsonResponse("The created project", projectSchema),
    400: errorResponse(
      "Invalid body, workspace ID could not be determined, copy without fromProjectId, or more than 500 open tasks to copy",
    ),
    403: errorResponse(
      "No workspace access, missing project:create permission, or task:create when copying open tasks",
    ),
    404: errorResponse(
      "The source project is not a live project of the workspace",
    ),
    409: errorResponse("Another project in the workspace already uses the key"),
  },
});

const getProjectRoute = createRoute({
  method: "get",
  operationId: "getProject",
  path: "/{id}",
  tags: ["Projects"],
  summary: "Get project",
  description: "Get a single project by ID.",
  middleware: [workspaceAccess.fromProject()] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse("Project details", projectSchema),
    403: errorResponse("No access to the project's workspace"),
    404: lookupNotFound("project"),
  },
});

const reorderProjectsRoute = createRoute({
  method: "put",
  operationId: "reorderProjects",
  path: "/reorder",
  tags: ["Projects"],
  summary: "Reorder projects",
  description:
    "Set the sidebar order of a workspace's projects. The given positions express relative order only -- the workspace is renumbered to 0..n-1.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    query: workspaceIdQuery,
    body: {
      required: true,
      content: { "application/json": { schema: reorderProjectsBody } },
    },
  },
  responses: {
    // Reorder returns the plain project rows, without the list route's
    // rollup statistics.
    200: jsonResponse("The reordered projects", z.array(projectSchema)),
    400: errorResponse("Invalid body, or workspace ID could not be determined"),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
  },
});

const updateProjectRoute = createRoute({
  method: "put",
  operationId: "updateProject",
  path: "/{id}",
  tags: ["Projects"],
  summary: "Update project",
  description:
    "Replace a project's name, icon, slug, description, and visibility, and optionally set its lead and default assignee (omit either to keep it, null to clear it; both must be workspace members). The slug must stay unique in the workspace, ignoring case. Feature flags are left unchanged; use the features route.",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: projectParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateProjectBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated project", projectSchema),
    400: errorResponse(
      "Invalid body, or a lead or default assignee who is not a workspace member",
    ),
    403: errorResponse(
      "No workspace access, missing project:update, or missing project:share when visibility changes",
    ),
    404: lookupNotFound("project"),
    409: errorResponse("Another project in the workspace already uses the key"),
  },
});

const updateProjectFeaturesRoute = createRoute({
  method: "patch",
  operationId: "updateProjectFeatures",
  path: "/{id}/features",
  tags: ["Projects"],
  summary: "Update project features",
  description:
    "Turn project features on or off. Only the flags sent change. While a feature is off, its routes answer 403 and its data is kept. Archived projects can be changed too.",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: {
    params: projectParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateProjectFeaturesBody } },
    },
  },
  responses: {
    200: jsonResponse("The project with its current flags", projectSchema),
    400: errorResponse(
      "Invalid body: an unknown key, a non-boolean value, or no flag at all",
    ),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
    404: lookupNotFound("project"),
  },
});

const deleteProjectRoute = createRoute({
  method: "delete",
  operationId: "deleteProject",
  path: "/{id}",
  tags: ["Projects"],
  summary: "Delete project",
  description:
    "Move a project and its tasks to the workspace trash (project.deleted is published). A trashed project reads as gone everywhere but the trash: restore it or delete it permanently through the trash routes; trash older than TRASH_RETENTION_DAYS is deleted permanently.",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["delete"] }),
  ] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse("The trashed project", projectSchema),
    403: errorResponse(
      "No workspace access, or missing project:delete permission",
    ),
    404: lookupNotFound("project"),
  },
});

const archiveProjectRoute = createRoute({
  method: "put",
  operationId: "archiveProject",
  path: "/{id}/archive",
  tags: ["Projects"],
  summary: "Archive project",
  description:
    "Hide a project from the default list without deleting it; its tasks, cycles and modules are kept. Reversible with unarchive. Archiving an archived project returns it unchanged (the first archive time stays). Publishes project.archived when the state changed.",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse("The archived project", projectSchema),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
    404: lookupNotFound("project"),
  },
});

const unarchiveProjectRoute = createRoute({
  method: "put",
  operationId: "unarchiveProject",
  path: "/{id}/unarchive",
  tags: ["Projects"],
  summary: "Unarchive project",
  description:
    "Return an archived project to the default list. Restoring an active project returns it unchanged. Publishes project.unarchived when the state changed.",
  middleware: [
    workspaceAccess.fromProject(),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: projectParam },
  responses: {
    200: jsonResponse("The restored project", projectSchema),
    403: errorResponse(
      "No workspace access, or missing project:update permission",
    ),
    404: lookupNotFound("project"),
  },
});

const project = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listProjectsRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const { includeArchived } = c.req.valid("query");
    const projects = await getProjectsCtrl(
      workspaceId,
      includeArchived === "true",
      await requestHiddenProjectIds(c),
    );
    // A project-limited API key sees only its own projects.
    const scope = c.get("apiKey")?.projectIds;
    return c.json(
      scope
        ? projects.filter((project) => scope.includes(project.id))
        : projects,
      200,
    );
  })
  .openapi(createProjectRoute, async (c) => {
    const { name, icon, slug, fromProjectId, copy, visibility } =
      c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    // A restricted source the caller cannot see reads as missing.
    if (fromProjectId) {
      await assertProjectVisible(c.get("userId"), fromProjectId);
    }
    if (copy && !fromProjectId) {
      throw new HTTPException(400, {
        message: "copy: needs fromProjectId",
      });
    }
    if (
      copy?.openTasks &&
      !(await hasWorkspacePermission(c, { task: ["create"] }))
    ) {
      throw new HTTPException(403, {
        message: "Copying open tasks needs the task:create permission",
      });
    }
    const newProject = await createProjectCtrl(
      workspaceId,
      name,
      icon,
      slug,
      c.get("userId"),
      fromProjectId
        ? {
            projectId: fromProjectId,
            taskTemplates: copy?.taskTemplates ?? false,
            openTasks: copy?.openTasks ?? false,
          }
        : undefined,
      { visibility },
    );
    return c.json(newProject, 200);
  })
  .openapi(getProjectRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const projectData = await getProjectCtrl(id, workspaceId);
    return c.json(projectData, 200);
  })
  .openapi(reorderProjectsRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const { projects } = c.req.valid("json");
    const reordered = await reorderProjectsCtrl(
      workspaceId,
      projects,
      await requestHiddenProjectIds(c),
    );
    return c.json(reordered, 200);
  })
  .openapi(updateProjectRoute, async (c) => {
    const { id } = c.req.valid("param");
    const {
      name,
      icon,
      slug,
      description,
      isPublic,
      leadUserId,
      defaultAssigneeUserId,
    } = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const updatedProject = await updateProjectCtrl(
      id,
      name,
      icon,
      slug,
      description,
      isPublic,
      workspaceId,
      await hasWorkspacePermission(c, { project: ["share"] }),
      c.get("userId"),
      { leadUserId, defaultAssigneeUserId },
    );
    return c.json(updatedProject, 200);
  })
  .openapi(updateProjectFeaturesRoute, async (c) => {
    const updated = await updateProjectFeaturesCtrl({
      projectId: c.req.valid("param").id,
      workspaceId: c.get("workspaceId"),
      userId: c.get("userId"),
      changes: c.req.valid("json"),
    });
    return c.json(updated, 200);
  })
  .openapi(deleteProjectRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const deletedProject = await deleteProjectCtrl(
      id,
      workspaceId,
      c.get("userId"),
    );
    return c.json(deletedProject, 200);
  })
  .openapi(archiveProjectRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const archivedProject = await archiveProjectCtrl(
      id,
      workspaceId,
      c.get("userId"),
    );
    return c.json(archivedProject, 200);
  })
  .openapi(unarchiveProjectRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const unarchivedProject = await unarchiveProjectCtrl(
      id,
      workspaceId,
      c.get("userId"),
    );
    return c.json(unarchivedProject, 200);
  })
  .route("/", projectAccessRoutes);

export default project;
