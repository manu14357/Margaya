// A minimal Slack Web API caller. Requests go only to slack.com (or a
// response_url on hooks.slack.com), with a timeout and no redirects. Errors
// carry Slack's error code, never the token or the request body.

const SLACK_API_BASE = "https://slack.com/api";
const SLACK_TIMEOUT_MS = 10_000;

export class SlackApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: string,
  ) {
    super(`Slack ${method} failed: ${code}`);
    this.name = "SlackApiError";
  }
}

type SlackOk = { ok: boolean; error?: string } & Record<string, unknown>;

// Slack takes JSON bodies only for its write methods. Read methods ignore a
// JSON body and answer as if their arguments were missing, so they get form
// fields instead.
const FORM_METHODS = new Set(["chat.getPermalink"]);

function formBody(body: Record<string, unknown>): string {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    form.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return form.toString();
}

async function send(
  url: string,
  init: { token?: string; body: unknown; label: string; form?: boolean },
): Promise<SlackOk> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "content-type": init.form
        ? "application/x-www-form-urlencoded"
        : "application/json; charset=utf-8",
    };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: init.form
        ? formBody((init.body ?? {}) as Record<string, unknown>)
        : JSON.stringify(init.body ?? {}),
      redirect: "error",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new SlackApiError(init.label, `http_${response.status}`);
    }
    try {
      return text ? (JSON.parse(text) as SlackOk) : { ok: true };
    } catch {
      // response_url answers plain "ok".
      return { ok: text.trim() === "ok" };
    }
  } catch (error) {
    if (error instanceof SlackApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SlackApiError(init.label, "timeout");
    }
    throw new SlackApiError(init.label, "network_error");
  } finally {
    clearTimeout(timeout);
  }
}

/** Calls a Web API method; throws `SlackApiError` when Slack says !ok. */
export async function callSlack<T extends Record<string, unknown>>(
  token: string,
  method: string,
  body: Record<string, unknown> = {},
): Promise<T & { ok: true }> {
  const result = await send(`${SLACK_API_BASE}/${method}`, {
    token,
    body,
    label: method,
    form: FORM_METHODS.has(method),
  });
  if (!result.ok) {
    throw new SlackApiError(method, result.error ?? "unknown_error");
  }
  return result as T & { ok: true };
}

/** Only Slack's own hooks host may receive a response_url post. */
export function isSlackResponseUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "hooks.slack.com";
  } catch {
    return false;
  }
}

/** Posts a message to an interaction's response_url (ephemeral by default). */
export async function respondToSlack(
  responseUrl: unknown,
  message: Record<string, unknown>,
): Promise<void> {
  if (!isSlackResponseUrl(responseUrl)) return;
  await send(responseUrl, {
    body: { response_type: "ephemeral", replace_original: false, ...message },
    label: "response_url",
  });
}
