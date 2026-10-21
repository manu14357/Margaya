import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { requireUserSession } from "../utils/require-user-session";
import { MAX_AVATAR_BYTES, MAX_AVATAR_REQUEST_BYTES } from "./avatar";
import {
  getAccountSecurity,
  revokeUserSession,
} from "./controllers/account-security";
import deleteAvatar from "./controllers/delete-avatar";
import saveAvatar from "./controllers/save-avatar";
import {
  getUserPreferences,
  updateUserPreferences,
} from "./controllers/user-preferences";
import {
  getUserTimezoneSetting,
  setUserTimezone,
} from "./controllers/user-timezone";
import {
  getUserPreferencesRoute,
  updateUserPreferencesRoute,
} from "./preferences-routes";
import {
  accountSecuritySchema,
  avatarDeletedSchema,
  avatarSchema,
  sessionRevokedSchema,
} from "./response";
import { sessionParam, uploadAvatarBody } from "./schema";
import {
  getUserTimezoneRoute,
  updateUserTimezoneRoute,
} from "./timezone-routes";

const uploadAvatarRoute = createRoute({
  method: "put",
  operationId: "uploadUserAvatar",
  path: "/avatar",
  tags: ["User"],
  summary: "Upload avatar",
  description: `Store a base64 encoded avatar (PNG, JPEG, or WebP, up to ${Math.floor(
    MAX_AVATAR_BYTES / 1024,
  )}KB) for the current user and return its public URL. Replaces any existing avatar.`,
  middleware: [boundedRequestBody(MAX_AVATAR_REQUEST_BYTES)] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: uploadAvatarBody } },
    },
  },
  responses: {
    200: jsonResponse("Avatar stored", avatarSchema),
    408: errorResponse("Request body timed out"),
    413: errorResponse("Request body exceeds the upload limit"),
    400: errorResponse(
      "Unsupported content type, malformed base64, or too large",
    ),
  },
});

const deleteAvatarRoute = createRoute({
  method: "delete",
  operationId: "deleteUserAvatar",
  path: "/avatar",
  tags: ["User"],
  summary: "Delete avatar",
  description:
    "Remove the uploaded avatar of the current user. Succeeds even when there was nothing to remove.",
  responses: {
    200: jsonResponse("Avatar removed", avatarDeletedSchema),
  },
});

const getAccountSecurityRoute = createRoute({
  method: "get",
  operationId: "getAccountSecurity",
  path: "/security",
  tags: ["User"],
  summary: "Get account security",
  description:
    "Whether the signed-in user has a password, and their active sessions with device, IP and times. Session tokens are never returned. Requires a signed-in session; API keys are refused.",
  middleware: [requireUserSession] as const,
  responses: {
    200: jsonResponse(
      "Password state and active sessions",
      accountSecuritySchema,
    ),
    403: errorResponse("Called with an API key instead of a session"),
  },
});

const revokeSessionRoute = createRoute({
  method: "delete",
  operationId: "revokeUserSession",
  path: "/sessions/{id}",
  tags: ["User"],
  summary: "Sign out a session",
  description:
    "Sign out one of the signed-in user's other sessions. Only the caller's own sessions can be revoked; any other id answers 404. To end the current session, sign out instead.",
  middleware: [requireUserSession] as const,
  request: { params: sessionParam },
  responses: {
    200: jsonResponse("The session was signed out", sessionRevokedSchema),
    400: errorResponse("The id is the current session"),
    403: errorResponse("Called with an API key instead of a session"),
    404: errorResponse("No such session for this user"),
  },
});

const user = apiRouter()
  .openapi(getUserPreferencesRoute, async (c) =>
    c.json(await getUserPreferences(c.get("userId")), 200),
  )
  .openapi(updateUserPreferencesRoute, async (c) =>
    c.json(
      await updateUserPreferences(c.get("userId"), c.req.valid("json")),
      200,
    ),
  )
  .openapi(getUserTimezoneRoute, async (c) =>
    c.json(await getUserTimezoneSetting(c.get("userId")), 200),
  )
  .openapi(updateUserTimezoneRoute, async (c) =>
    c.json(
      await setUserTimezone(c.get("userId"), c.req.valid("json").timezone),
      200,
    ),
  )
  .openapi(uploadAvatarRoute, async (c) => {
    const { contentType, data } = c.req.valid("json");
    try {
      return c.json(
        await saveAvatar({ userId: c.get("userId"), contentType, data }),
        200,
      );
    } catch (error) {
      throw new HTTPException(400, {
        message:
          error instanceof Error ? error.message : "Invalid avatar upload",
      });
    }
  })
  .openapi(deleteAvatarRoute, async (c) =>
    c.json(await deleteAvatar(c.get("userId")), 200),
  )
  .openapi(getAccountSecurityRoute, async (c) =>
    c.json(
      await getAccountSecurity(c.get("userId"), c.get("session")?.id ?? ""),
      200,
    ),
  )
  .openapi(revokeSessionRoute, async (c) =>
    c.json(
      await revokeUserSession(
        c.get("userId"),
        c.get("session")?.id ?? "",
        c.req.valid("param").id,
      ),
      200,
    ),
  );

export default user;
