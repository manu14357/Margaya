import { requireIntakeFeatureForProject } from "../intake/access";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  nullableResponseTimestamp,
  z,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  getEmailSettings,
  rotateEmailAddress,
  testProjectMailbox,
  updateEmailSettings,
} from "./settings";

// Email intake settings routes (#8, tag "Intake email"). They need
// project:share and the project's Intake feature.

const TAGS = ["Intake email"];
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

const emailSettingsSchema = z
  .object({
    projectId: z.string(),
    enabled: z.boolean(),
    address: z.string().nullable().openapi({
      description:
        "The project's forwarding address. Null until email intake is first saved, or while the instance has no INTAKE_EMAIL_ADDRESS.",
    }),
    instance: z
      .object({
        address: z.boolean().openapi({
          description: "The instance has a base intake address.",
        }),
        mailbox: z.boolean().openapi({
          description: "The instance polls a shared IMAP mailbox.",
        }),
        webhook: z.boolean().openapi({
          description: "The inbound mail webhook is configured.",
        }),
      })
      .openapi("IntakeEmailInstance"),
    allowedDomains: z.array(z.string()),
    blockedDomains: z.array(z.string()),
    imap: z
      .object({
        enabled: z.boolean(),
        host: z.string().nullable(),
        port: z.number().nullable(),
        security: z.enum(["tls", "starttls"]),
        username: z.string().nullable(),
        folder: z.string(),
        hasPassword: z.boolean().openapi({
          description: "A password is stored. It is never returned.",
        }),
      })
      .openapi("IntakeEmailMailbox"),
    limits: z
      .object({
        maxMessageBytes: z.number(),
        maxAttachmentBytes: z.number(),
        maxAttachments: z.number(),
      })
      .openapi("IntakeEmailLimits"),
    lastPolledAt: nullableResponseTimestamp,
    lastReceivedAt: nullableResponseTimestamp,
    lastError: z.string().nullable().openapi({
      description: "Why the project's mailbox couldn't be read last time.",
    }),
  })
  .openapi("IntakeEmailSettings");

const domainList = z.array(z.string().max(253)).max(200);

const updateEmailSettingsBody = z
  .object({
    enabled: z.boolean().optional(),
    allowedDomains: domainList.optional().openapi({
      description:
        "When not empty, only senders from these domains (and their subdomains) are filed.",
    }),
    blockedDomains: domainList.optional().openapi({
      description: "Senders from these domains are never filed.",
    }),
    imap: z
      .object({
        enabled: z.boolean().optional(),
        host: z.string().max(253).nullable().optional(),
        port: z.number().int().min(1).max(65_535).nullable().optional(),
        security: z.enum(["tls", "starttls"]).optional(),
        username: z.string().max(320).nullable().optional(),
        password: z.string().max(1_000).nullable().optional().openapi({
          description:
            "Omit to keep the stored password; null or empty removes it. Stored encrypted.",
        }),
        folder: z.string().max(255).optional(),
      })
      .strict()
      .optional()
      .openapi({
        description:
          "The project's own IMAP mailbox, polled every two minutes. Every unread message in it is filed into this project.",
      }),
  })
  .strict()
  .openapi("UpdateIntakeEmailSettings");

const mailboxTestSchema = z
  .object({
    ok: z.boolean(),
    unread: z.number().nullable(),
    error: z.string().nullable(),
  })
  .openapi("IntakeEmailMailboxTest");

const getRoute = createRoute({
  method: "get",
  operationId: "getIntakeEmailSettings",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "Get email intake settings",
  description:
    "The project's forwarding address, sender filters, optional mailbox and its last poll, and what the instance offers.",
  middleware: [...middleware] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The settings", emailSettingsSchema),
    403: errorResponse(FORBIDDEN),
    404: errorResponse(PROJECT_NOT_FOUND),
  },
});

const updateRoute = createRoute({
  method: "put",
  operationId: "updateIntakeEmailSettings",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "Update email intake settings",
  description:
    "Turn email intake on or off, set the sender domain lists and the project's own mailbox. The first save creates the forwarding address.",
  middleware: [...middleware] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateEmailSettingsBody } },
    },
  },
  responses: {
    200: jsonResponse("The settings", emailSettingsSchema),
    400: errorResponse("Invalid body, a bad domain, or an incomplete mailbox"),
    403: errorResponse(FORBIDDEN),
    404: errorResponse(PROJECT_NOT_FOUND),
  },
});

const rotateRoute = createRoute({
  method: "post",
  operationId: "rotateIntakeEmailAddress",
  path: "/project/{projectId}/rotate",
  tags: TAGS,
  summary: "Change the forwarding address",
  description:
    "Give the project a new forwarding address. Mail to the old one is no longer filed.",
  middleware: [...middleware] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The settings", emailSettingsSchema),
    403: errorResponse(FORBIDDEN),
    404: errorResponse("Project not found, or email intake isn't set up"),
  },
});

const testRoute = createRoute({
  method: "post",
  operationId: "testIntakeEmailMailbox",
  path: "/project/{projectId}/test",
  tags: TAGS,
  summary: "Test the project mailbox",
  description:
    "Sign in to the saved mailbox and count its unread messages, without reading or changing any.",
  middleware: [...middleware] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The result", mailboxTestSchema),
    400: errorResponse("No mailbox saved"),
    403: errorResponse(FORBIDDEN),
    404: errorResponse(PROJECT_NOT_FOUND),
  },
});

const intakeEmail = apiRouter()
  .openapi(getRoute, async (c) =>
    c.json(await getEmailSettings(c.req.valid("param").projectId), 200),
  )
  .openapi(updateRoute, async (c) =>
    c.json(
      await updateEmailSettings(
        c.req.valid("param").projectId,
        c.req.valid("json"),
      ),
      200,
    ),
  )
  .openapi(rotateRoute, async (c) =>
    c.json(await rotateEmailAddress(c.req.valid("param").projectId), 200),
  )
  .openapi(testRoute, async (c) =>
    c.json(await testProjectMailbox(c.req.valid("param").projectId), 200),
  );

export default intakeEmail;
