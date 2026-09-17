import { sendTestEmail } from "@margaya/email";
import { HTTPException } from "hono/http-exception";
import { getInstanceSettings } from "../../instance-settings/snapshot";
import { enforceRateLimits } from "../../utils/rate-limit";
import { testEmailLimiter } from "../limits";

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

/** A5: send a short message with the effective SMTP settings. */
export async function sendInstanceTestEmail(input: {
  to?: string;
  callerEmail: string;
  callerId: string;
}) {
  const to = input.to || input.callerEmail;
  if (!EMAIL.test(to)) {
    throw new HTTPException(400, { message: "Enter a valid email address" });
  }
  await enforceRateLimits([[testEmailLimiter, input.callerId]]);
  const settings = getInstanceSettings();
  if (!settings.derived.smtpConfigured) {
    throw new HTTPException(409, { message: "Set up email first" });
  }
  return sendTestEmail(to, { instanceName: settings.effective.instanceName });
}
