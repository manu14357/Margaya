import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createFavorite from "./controllers/create-favorite";
import {
  deleteFavorite,
  deleteFavoriteByEntity,
} from "./controllers/delete-favorite";
import listFavorites from "./controllers/list-favorites";
import reorderFavorites from "./controllers/reorder-favorites";
import {
  favoriteListSchema,
  favoriteRemovalSchema,
  favoriteSchema,
} from "./response";
import {
  createFavoriteBody,
  favoriteEntityParam,
  favoriteParam,
  reorderFavoritesBody,
  workspaceIdQuery,
} from "./schema";

// Favorites are personal: every query is scoped to the caller's own rows.

const listFavoritesRoute = createRoute({
  method: "get",
  operationId: "listFavorites",
  path: "/",
  tags: ["Favorites"],
  summary: "List favorites",
  description:
    "List the caller's favorites in a workspace, in display order. Favorites whose entity or project is archived, or whose feature is turned off, are hidden until restored; favorites of deleted entities are removed.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("The caller's visible favorites", favoriteListSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
  },
});

const createFavoriteRoute = createRoute({
  method: "post",
  operationId: "createFavorite",
  path: "/",
  tags: ["Favorites"],
  summary: "Add favorite",
  description:
    "Add an entity to the caller's favorites, on top of the list. Adding one that is already a favorite returns the existing favorite.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createFavoriteBody } },
    },
  },
  responses: {
    200: jsonResponse("The new or existing favorite", favoriteSchema),
    400: errorResponse("Invalid body, or an unsupported entity type"),
    403: errorResponse(
      "No workspace access, or missing project:read permission",
    ),
    404: errorResponse("The entity does not exist in this workspace"),
    409: errorResponse(
      "The entity is archived or its feature is turned off, or the caller already has 100 favorites",
    ),
  },
});

const reorderFavoritesRoute = createRoute({
  method: "put",
  operationId: "reorderFavorites",
  path: "/reorder",
  tags: ["Favorites"],
  summary: "Reorder favorites",
  description:
    "Set the order of the caller's favorites. Favorites left out keep their rank; the list is renumbered to 0..n-1.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: {
    query: workspaceIdQuery,
    body: {
      required: true,
      content: { "application/json": { schema: reorderFavoritesBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The caller's visible favorites in their new order",
      favoriteListSchema,
    ),
    400: errorResponse(
      "Invalid body, or an id that is not one of the caller's favorites",
    ),
    403: errorResponse("No access to the workspace"),
  },
});

const deleteFavoriteByEntityRoute = createRoute({
  method: "delete",
  operationId: "deleteFavoriteByEntity",
  path: "/entity/{entityType}/{entityId}",
  tags: ["Favorites"],
  summary: "Remove favorite by entity",
  description:
    "Remove the caller's favorite of an entity. Reports whether anything was removed.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { params: favoriteEntityParam, query: workspaceIdQuery },
  responses: {
    200: jsonResponse("Whether a favorite was removed", favoriteRemovalSchema),
    400: errorResponse("Invalid entity type, or workspace ID missing"),
    403: errorResponse("No access to the workspace"),
  },
});

const deleteFavoriteRoute = createRoute({
  method: "delete",
  operationId: "deleteFavorite",
  path: "/{id}",
  tags: ["Favorites"],
  summary: "Remove favorite",
  description: "Remove one of the caller's favorites.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { params: favoriteParam, query: workspaceIdQuery },
  responses: {
    200: jsonResponse("The favorite was removed", favoriteRemovalSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse("No access to the workspace"),
    404: errorResponse(
      "No favorite with this id belongs to the caller in this workspace",
    ),
  },
});

const favorite = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listFavoritesRoute, async (c) =>
    c.json(await listFavorites(c.get("userId"), c.get("workspaceId")), 200),
  )
  .openapi(createFavoriteRoute, async (c) => {
    const { entityType, entityId } = c.req.valid("json");
    return c.json(
      await createFavorite({
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
        entityType,
        entityId,
      }),
      200,
    );
  })
  .openapi(reorderFavoritesRoute, async (c) =>
    c.json(
      await reorderFavorites(
        c.get("userId"),
        c.get("workspaceId"),
        c.req.valid("json").favoriteIds,
      ),
      200,
    ),
  )
  .openapi(deleteFavoriteByEntityRoute, async (c) => {
    const { entityType, entityId } = c.req.valid("param");
    return c.json(
      await deleteFavoriteByEntity(
        c.get("userId"),
        c.get("workspaceId"),
        entityType,
        entityId,
      ),
      200,
    );
  })
  .openapi(deleteFavoriteRoute, async (c) =>
    c.json(
      await deleteFavorite(
        c.get("userId"),
        c.get("workspaceId"),
        c.req.valid("param").id,
      ),
      200,
    ),
  );

export default favorite;
