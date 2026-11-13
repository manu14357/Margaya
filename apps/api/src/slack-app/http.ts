import type { Context } from "hono";
import { handleInbound, type SlackInbound } from "./inbound";
import { verifySlackSignature } from "./signature";
import { loadActiveConnection } from "./store";

// HTTP mode: Slack posts Events, Interactivity and the slash command to
// /api/slack/events/{workspaceId}. Each request must carry a valid signature
// from the app's signing secret and a timestamp within five minutes.
// Mounted before the session middleware: the signature is the credential.

const MAX_BODY_BYTES = 1024 * 1024;

export function inboundFromHttp(
  contentType: string,
  rawBody: string,
): SlackInbound | { challenge: string } | null {
  if (contentType.includes("application/json")) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (payload.type === "url_verification") {
      return typeof payload.challenge === "string"
        ? { challenge: payload.challenge }
        : null;
    }
    return { kind: "event", payload };
  }
  const form = new URLSearchParams(rawBody);
  const interactive = form.get("payload");
  if (interactive) {
    try {
      return {
        kind: "interactive",
        payload: JSON.parse(interactive) as Record<string, unknown>,
      };
    } catch {
      return null;
    }
  }
  if (form.get("command")) {
    return { kind: "command", payload: Object.fromEntries(form.entries()) };
  }
  return null;
}

export async function handleSlackEventsRoute(c: Context) {
  const workspaceId = c.req.param("workspaceId");
  if (!workspaceId) return c.text("Not found", 404);

  const length = Number(c.req.header("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return c.text("Payload too large", 413);
  const rawBody = await c.req.text();
  if (rawBody.length > MAX_BODY_BYTES) return c.text("Payload too large", 413);

  const connection = await loadActiveConnection(workspaceId);
  // Same answer for "no connection", "socket mode" and "bad signature", so
  // the endpoint doesn't reveal which workspaces use Slack.
  const signingSecret =
    connection?.mode === "http" ? connection.signingSecret : null;
  if (
    !connection ||
    !signingSecret ||
    !verifySlackSignature({
      signingSecret,
      timestamp: c.req.header("x-slack-request-timestamp"),
      signature: c.req.header("x-slack-signature"),
      rawBody,
    }).ok
  ) {
    return c.text("Unauthorized", 401);
  }

  const inbound = inboundFromHttp(c.req.header("content-type") ?? "", rawBody);
  if (!inbound) return c.text("Bad request", 400);
  if ("challenge" in inbound) return c.json({ challenge: inbound.challenge });

  // A retried event was already handled (or is being handled) once.
  if (inbound.kind === "event" && c.req.header("x-slack-retry-num")) {
    return c.body(null, 200);
  }

  const result = await handleInbound(connection, inbound);
  if (result.body === undefined) return c.body(null, 200);
  return c.json(result.body as Record<string, unknown>, 200);
}
