import { createRoute, errorResponse, jsonResponse } from "../openapi";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { userPreferencesSchema } from "./response";
import { updateUserPreferencesBody } from "./schema";

const PREFERENCES_BODY_BYTES = 16 * 1024;

export const getUserPreferencesRoute = createRoute({
  method: "get",
  operationId: "getUserPreferences",
  path: "/preferences",
  tags: ["User"],
  summary: "Get preferences",
  description:
    "The current user's web preferences (theme, week start, display toggles, sidebar layout), shared by every device they sign in on. Null until they save any.",
  responses: {
    200: jsonResponse("The user's preferences", userPreferencesSchema),
    404: errorResponse("User not found"),
  },
});

export const updateUserPreferencesRoute = createRoute({
  method: "patch",
  operationId: "updateUserPreferences",
  path: "/preferences",
  tags: ["User"],
  summary: "Update preferences",
  description:
    "Change some of the current user's web preferences. Keys left out keep their stored value.",
  middleware: [boundedRequestBody(PREFERENCES_BODY_BYTES)] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: updateUserPreferencesBody } },
    },
  },
  responses: {
    200: jsonResponse("The stored preferences", userPreferencesSchema),
    400: errorResponse("Unknown key or invalid value"),
    404: errorResponse("User not found"),
    413: errorResponse("The body is too large"),
  },
});
