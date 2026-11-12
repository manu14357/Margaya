import type { MiddlewareHandler } from "hono";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { perIpLimit, publicResponseHeaders } from "../public-board/gate";
import { clientIp, PUBLIC_LIMITS } from "../public-board/limits";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { createRateLimiter, enforceRateLimits } from "../utils/rate-limit";
import {
  FIELD_MODES,
  resolvePublicForm,
  submitPublicForm,
  toPublicForm,
} from "./service";

// The public request form (#8, tag "Request forms"), mounted before the
// app-wide auth middleware: nobody signs in. Answers carry the admin's form
// copy and chosen fields only, never project or workspace data.

const TAGS = ["Request forms"];
const FORM_404 =
  "Unknown or closed form, Intake off, project archived, or public sharing off";
const BODY_LIMIT_BYTES = 64 * 1024;

const LIMITS = {
  ipHour: createRateLimiter({
    name: "public-form-ip",
    windowSeconds: 60 * 60,
    max: 10,
  }),
  ipDay: createRateLimiter({
    name: "public-form-ip-day",
    windowSeconds: 24 * 60 * 60,
    max: 30,
  }),
  formHour: createRateLimiter({
    name: "public-form",
    windowSeconds: 60 * 60,
    max: 100,
  }),
};

const tokenParam = z.object({ token: z.string().max(64) });
const fieldMode = z.enum(FIELD_MODES);

const publicFormSchema = z
  .object({
    title: z.string().nullable().openapi({
      description: "Null shows the app's default heading.",
    }),
    intro: z.string().nullable(),
    fields: z.object({
      description: fieldMode,
      email: fieldMode,
      name: fieldMode,
    }),
    customFields: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.enum(["text", "number", "date", "dropdown", "boolean"]),
        options: z.array(z.string()).nullable(),
        required: z.boolean(),
      }),
    ),
    confirmationMessage: z.string().nullable(),
  })
  .openapi("PublicIntakeForm");

const submissionBody = z
  .object({
    title: z.string().max(2_000),
    description: z.string().max(30_000).optional(),
    email: z.string().max(320).optional(),
    name: z.string().max(500).optional(),
    customFields: z
      .record(z.string().max(64), z.string().max(2_000))
      .optional(),
    website: z.string().max(2_000).optional().openapi({
      description:
        "Leave empty. A spam trap: the web form hides it from people.",
    }),
    elapsedMs: z.number().int().min(0).optional().openapi({
      description:
        "Milliseconds between showing the form and sending it; under two seconds is treated as automated.",
    }),
  })
  .openapi("PublicIntakeFormSubmission");

const submissionResultSchema = z
  .object({ confirmationMessage: z.string().nullable() })
  .openapi("PublicIntakeFormResult");

function submitLimits(): MiddlewareHandler {
  return async (c, next) => {
    const ip = clientIp(c);
    await enforceRateLimits([
      [LIMITS.ipHour, ip],
      [LIMITS.ipDay, ip],
      [LIMITS.formHour, c.req.param("token") ?? ""],
    ]);
    return next();
  };
}

const getFormRoute = createRoute({
  method: "get",
  operationId: "getPublicIntakeForm",
  path: "/{token}",
  tags: TAGS,
  summary: "Get a request form",
  description:
    "The form's heading, introduction, fields and confirmation. Works without signing in.",
  security: [],
  middleware: [publicResponseHeaders(), perIpLimit(PUBLIC_LIMITS.read)],
  request: { params: tokenParam },
  responses: {
    200: jsonResponse("The form", publicFormSchema),
    404: errorResponse(FORM_404),
    429: errorResponse("Too many requests; see Retry-After"),
  },
});

const submitFormRoute = createRoute({
  method: "post",
  operationId: "submitPublicIntakeForm",
  path: "/{token}",
  tags: TAGS,
  summary: "Send a request",
  description:
    "Files a request into the project's intake with source form. Limited to 10 an hour and 30 a day per IP address, and 100 an hour per form. Works without signing in; the answer holds only the confirmation message.",
  security: [],
  middleware: [
    publicResponseHeaders(),
    perIpLimit(PUBLIC_LIMITS.write),
    boundedRequestBody(BODY_LIMIT_BYTES),
    submitLimits(),
  ],
  request: {
    params: tokenParam,
    body: {
      required: true,
      content: { "application/json": { schema: submissionBody } },
    },
  },
  responses: {
    200: jsonResponse("Sent", submissionResultSchema),
    400: errorResponse("A missing or invalid field"),
    404: errorResponse(FORM_404),
    409: errorResponse("The project is archived"),
    413: errorResponse("Request body is too large"),
    429: errorResponse("Too many requests; see Retry-After"),
  },
});

const publicIntakeForm = apiRouter()
  .openapi(getFormRoute, async (c) =>
    c.json(
      toPublicForm(await resolvePublicForm(c.req.valid("param").token)),
      200,
    ),
  )
  .openapi(submitFormRoute, async (c) =>
    c.json(
      await submitPublicForm(
        await resolvePublicForm(c.req.valid("param").token),
        c.req.valid("json"),
      ),
      200,
    ),
  );

export default publicIntakeForm;
