import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { requireUserSession } from "../utils/require-user-session";
import {
  checkSurvey,
  deleteOwnFeedback,
  getFeedbackConfig,
  listOwnFeedback,
  setSurveyPreference,
  snoozeSurvey,
  submitFeedback,
} from "./controllers/user";
import {
  deletedFeedbackSchema,
  feedbackConfigSchema,
  feedbackCreatedSchema,
  ownFeedbackListSchema,
  surveyCheckSchema,
  surveyStateSchema,
} from "./response";
import { submitFeedbackBody, surveyPreferenceBody } from "./schema";
import "./subscribers";

// Product feedback from the signed-in person (B: feedback collection). It
// stays on this instance: only its admins read it, under Instance settings
// → Feedback (admin.ts). People with a session only: API keys are refused,
// so scripts can't fill the admins' list.

const TAGS = ["Feedback"];
const SESSION_NOTE =
  " Needs a signed-in session (the web or desktop app); API keys are refused.";
const forbidden = errorResponse("An API key instead of a user session");

const getConfigRoute = createRoute({
  method: "get",
  operationId: "getFeedbackConfig",
  path: "/config",
  tags: TAGS,
  summary: "Get feedback availability",
  description: `Whether Send feedback and the occasional survey are on, the survey's scale, and whether this account chose Don't ask again.${SESSION_NOTE}`,
  middleware: [requireUserSession] as const,
  responses: {
    200: jsonResponse("Availability", feedbackConfigSchema),
    403: forbidden,
  },
});

const submitRoute = createRoute({
  method: "post",
  operationId: "submitFeedback",
  path: "/",
  tags: TAGS,
  summary: "Send feedback",
  description: `Record a rating, a comment or both. Context is coarse: a page type, the app version and web or desktop; never ids, names or task content. Only this instance's admins can read it. Limited to 10 a hour per person.${SESSION_NOTE}`,
  middleware: [requireUserSession, boundedRequestBody(8 * 1024)] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: submitFeedbackBody } },
    },
  },
  responses: {
    200: jsonResponse("Recorded", feedbackCreatedSchema),
    400: errorResponse("Invalid body, or a score outside the scale"),
    403: forbidden,
    409: errorResponse("Feedback, or the survey, is turned off"),
    413: errorResponse("The body is larger than 8 KB"),
    429: errorResponse("Too many in an hour; retry after Retry-After"),
  },
});

const checkSurveyRoute = createRoute({
  method: "post",
  operationId: "checkFeedbackSurvey",
  path: "/survey/check",
  tags: TAGS,
  summary: "Ask whether to show the survey",
  description: `Counts today as an active day and answers whether the survey card should show now. It never asks in an account's first 7 days, after Don't ask again, during a snooze, or before the instance's interval (90 days by default) has passed since it last asked; then it asks once a trigger is reached: a number of active days or of tasks this person completed. A yes is recorded as asked.${SESSION_NOTE}`,
  middleware: [requireUserSession] as const,
  responses: {
    200: jsonResponse("The answer", surveyCheckSchema),
    403: forbidden,
    429: errorResponse("Too many checks; retry after Retry-After"),
  },
});

const snoozeSurveyRoute = createRoute({
  method: "post",
  operationId: "snoozeFeedbackSurvey",
  path: "/survey/dismiss",
  tags: TAGS,
  summary: "Close the survey",
  description: `Closing the card without answering puts the survey off for 30 days.${SESSION_NOTE}`,
  middleware: [requireUserSession] as const,
  responses: {
    200: jsonResponse("The survey state", surveyStateSchema),
    403: forbidden,
  },
});

const surveyPreferenceRoute = createRoute({
  method: "put",
  operationId: "setFeedbackSurveyPreference",
  path: "/survey/preference",
  tags: TAGS,
  summary: "Turn the survey off or on for me",
  description: `optedOut true is Don't ask again; false lets the survey ask again. Send feedback stays available either way.${SESSION_NOTE}`,
  middleware: [requireUserSession] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: surveyPreferenceBody } },
    },
  },
  responses: {
    200: jsonResponse("The survey state", surveyStateSchema),
    400: errorResponse("Invalid body"),
    403: forbidden,
  },
});

const listMineRoute = createRoute({
  method: "get",
  operationId: "listOwnFeedback",
  path: "/mine",
  tags: TAGS,
  summary: "List my feedback",
  description: `Everything this account has sent, newest first (at most 500), for a copy of your data.${SESSION_NOTE}`,
  middleware: [requireUserSession] as const,
  responses: {
    200: jsonResponse("Your feedback", ownFeedbackListSchema),
    403: forbidden,
  },
});

const deleteMineRoute = createRoute({
  method: "delete",
  operationId: "deleteOwnFeedback",
  path: "/mine",
  tags: TAGS,
  summary: "Delete my feedback",
  description: `Delete everything this account has sent. Deleting the account does this too.${SESSION_NOTE}`,
  middleware: [requireUserSession] as const,
  responses: {
    200: jsonResponse("How many were deleted", deletedFeedbackSchema),
    403: forbidden,
  },
});

const feedback = apiRouter()
  .openapi(getConfigRoute, async (c) =>
    c.json(await getFeedbackConfig(c.get("userId")), 200),
  )
  .openapi(submitRoute, async (c) =>
    c.json(await submitFeedback(c.get("userId"), c.req.valid("json")), 200),
  )
  .openapi(checkSurveyRoute, async (c) =>
    c.json(await checkSurvey(c.get("userId")), 200),
  )
  .openapi(snoozeSurveyRoute, async (c) =>
    c.json(await snoozeSurvey(c.get("userId")), 200),
  )
  .openapi(surveyPreferenceRoute, async (c) =>
    c.json(
      await setSurveyPreference(c.get("userId"), c.req.valid("json").optedOut),
      200,
    ),
  )
  .openapi(listMineRoute, async (c) =>
    c.json(await listOwnFeedback(c.get("userId")), 200),
  )
  .openapi(deleteMineRoute, async (c) =>
    c.json(await deleteOwnFeedback(c.get("userId")), 200),
  );

export default feedback;
