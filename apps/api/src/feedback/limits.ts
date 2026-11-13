import { createRateLimiter } from "../utils/rate-limit";

// Per-person limits: feedback is a few words now and then, never a stream.

export const feedbackSubmitLimiter = createRateLimiter({
  name: "feedback-submit",
  windowSeconds: 60 * 60,
  max: 10,
});

// The web app checks once per visit and at quiet moments after that.
export const surveyCheckLimiter = createRateLimiter({
  name: "feedback-survey-check",
  windowSeconds: 60 * 60,
  max: 60,
});

export const feedbackAdminDeleteLimiter = createRateLimiter({
  name: "feedback-admin-delete",
  windowSeconds: 60,
  max: 60,
});
