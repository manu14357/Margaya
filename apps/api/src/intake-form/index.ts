import { requireIntakeFeatureForProject } from "../intake/access";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  FIELD_MODES,
  getFormSettings,
  MAX_FORM_CONFIRMATION,
  MAX_FORM_CUSTOM_FIELDS,
  MAX_FORM_INTRO,
  MAX_FORM_TITLE,
  rotateFormLink,
  updateFormSettings,
} from "./service";

// Request form settings (#8, tag "Request forms"). They need project:share,
// like publishing a board, and the project's Intake feature.

const TAGS = ["Request forms"];
const PROJECT_NOT_FOUND = "Project not found";
const FORBIDDEN =
  "No workspace access, missing project:share, or the Intake feature is off";

const middleware = [
  workspaceAccess.fromProject("projectId", {
    notFoundMessage: PROJECT_NOT_FOUND,
  }),
  requireWorkspacePermission({ project: ["share"] }),
  requireIntakeFeatureForProject,
] as const;

const projectIdParam = z.object({ projectId: z.string() });
const fieldMode = z.enum(FIELD_MODES);

const formSettingsSchema = z
  .object({
    projectId: z.string(),
    enabled: z.boolean(),
    path: z.string().nullable().openapi({
      description:
        "The form's path on the web app (/request-form/<token>); null until first saved.",
    }),
    title: z.string().nullable(),
    intro: z.string().nullable(),
    descriptionField: fieldMode,
    emailField: fieldMode,
    nameField: fieldMode,
    customFieldIds: z.array(z.string()),
    confirmationMessage: z.string().nullable(),
    publicSharingAllowed: z.boolean().openapi({
      description: "False while the server turns public sharing off.",
    }),
  })
  .openapi("IntakeFormSettings");

const updateFormBody = z
  .object({
    enabled: z.boolean().optional(),
    title: z.string().max(MAX_FORM_TITLE).nullable().optional(),
    intro: z.string().max(MAX_FORM_INTRO).nullable().optional(),
    descriptionField: fieldMode.optional(),
    emailField: fieldMode.optional(),
    nameField: fieldMode.optional(),
    customFieldIds: z
      .array(z.string().max(64))
      .max(MAX_FORM_CUSTOM_FIELDS)
      .optional()
      .openapi({
        description:
          "The project's custom fields the form asks for, in order. Their names and options become public.",
      }),
    confirmationMessage: z
      .string()
      .max(MAX_FORM_CONFIRMATION)
      .nullable()
      .optional(),
  })
  .strict()
  .openapi("UpdateIntakeFormSettings");

const getRoute = createRoute({
  method: "get",
  operationId: "getIntakeFormSettings",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "Get request form settings",
  description: "The project's public request form: its link, fields and copy.",
  middleware: [...middleware] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The form", formSettingsSchema),
    403: errorResponse(FORBIDDEN),
    404: errorResponse(PROJECT_NOT_FOUND),
  },
});

const updateRoute = createRoute({
  method: "put",
  operationId: "updateIntakeFormSettings",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "Update request form settings",
  description:
    "Open or close the form and choose its fields and copy. The first save creates the link.",
  middleware: [...middleware] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateFormBody } },
    },
  },
  responses: {
    200: jsonResponse("The form", formSettingsSchema),
    400: errorResponse("Invalid body, or a custom field of another project"),
    403: errorResponse(FORBIDDEN),
    404: errorResponse(PROJECT_NOT_FOUND),
    409: errorResponse("Public sharing is turned off on this server"),
  },
});

const rotateRoute = createRoute({
  method: "post",
  operationId: "rotateIntakeFormLink",
  path: "/project/{projectId}/rotate",
  tags: TAGS,
  summary: "Change the form link",
  description: "Give the form a new link; the old one stops working.",
  middleware: [...middleware] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The form", formSettingsSchema),
    403: errorResponse(FORBIDDEN),
    404: errorResponse("Project not found, or the form isn't set up"),
  },
});

const intakeForm = apiRouter()
  .openapi(getRoute, async (c) =>
    c.json(await getFormSettings(c.req.valid("param").projectId), 200),
  )
  .openapi(updateRoute, async (c) =>
    c.json(
      await updateFormSettings(
        c.req.valid("param").projectId,
        c.req.valid("json"),
      ),
      200,
    ),
  )
  .openapi(rotateRoute, async (c) =>
    c.json(await rotateFormLink(c.req.valid("param").projectId), 200),
  );

export default intakeForm;
