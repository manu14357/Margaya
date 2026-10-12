import { vi } from "vitest";
import type { createApp } from "../../../apps/api/src/index";
import { refreshInstanceSettings } from "../../../apps/api/src/instance-settings/snapshot";
import { resetTestDatabase } from "./database";

type App = ReturnType<typeof createApp>["app"];

export const ORIGIN = "http://localhost:5173";

/** Every cookie a response set, as a Cookie header. */
export function issuedCookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(";")[0] ?? "")
    .filter((pair) => pair.split("=").slice(1).join("=") !== "")
    .join("; ");
}

export function authPost(
  app: App,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(`/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * Signs up through Better Auth and returns the session cookie. The first
 * account on an empty instance becomes the instance admin.
 */
export async function signUpWithSession(app: App, email: string) {
  const response = await authPost(app, "/sign-up/email", {
    name: email.split("@")[0],
    email,
    password: "correct horse battery staple",
  });
  if (response.status !== 200) {
    throw new Error(
      `Sign-up failed (${response.status}): ${await response.text()}`,
    );
  }
  const body = (await response.json()) as {
    user: { id: string; email: string };
  };
  return { cookie: issuedCookies(response), user: body.user };
}

export function adminRequest(
  app: App,
  method: string,
  path: string,
  cookie: string | Record<string, string>,
  body?: unknown,
) {
  const auth = typeof cookie === "string" ? { cookie } : cookie;
  return app.request(`/api/instance-admin${path}`, {
    method,
    headers: {
      ...auth,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * The integration setup sets `DISABLE_*=false`, which locks those settings to
 * the environment. Blank them so the panel manages them (the DB path).
 */
export function unlockSignUpSettings() {
  for (const name of [
    "DISABLE_GUEST_ACCESS",
    "DISABLE_REGISTRATION",
    "DISABLE_PASSWORD_REGISTRATION",
    "DISABLE_EMAIL_OTP_SIGN_IN",
    "DISABLE_LOGIN_FORM",
    "DISABLE_WORKSPACE_CREATION",
  ]) {
    vi.stubEnv(name, "");
  }
}

/** A clean database and a snapshot that no longer holds old rows. */
export async function resetInstanceState() {
  await resetTestDatabase();
  await refreshInstanceSettings();
}
