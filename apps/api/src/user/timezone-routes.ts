import { createRoute, errorResponse, jsonResponse } from "../openapi";
import { userTimezoneSchema } from "./response";
import { updateUserTimezoneBody } from "./schema";

export const getUserTimezoneRoute = createRoute({
  method: "get",
  operationId: "getUserTimezone",
  path: "/timezone",
  tags: ["User"],
  summary: "Get time zone",
  description:
    "The current user's time zone for server-rendered times such as reminders and email digests. Null means not chosen yet; the server then uses UTC. The web app always renders in the browser's zone.",
  responses: {
    200: jsonResponse("The user's time zone", userTimezoneSchema),
    404: errorResponse("User not found"),
  },
});

export const updateUserTimezoneRoute = createRoute({
  method: "put",
  operationId: "updateUserTimezone",
  path: "/timezone",
  tags: ["User"],
  summary: "Set time zone",
  description:
    "Store the current user's IANA time zone, or null to clear it (UTC applies).",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: updateUserTimezoneBody } },
    },
  },
  responses: {
    200: jsonResponse("The stored time zone", userTimezoneSchema),
    400: errorResponse("Invalid body or unknown time zone"),
  },
});
