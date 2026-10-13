import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  Page,
} from "@playwright/test";
import { eventually, expectJson, type TestUser } from "./api-kit";
import { E2E_WEB_URL } from "./env";
import type { MailpitClient, MailpitMessage } from "./mailpit";

// Helpers for the notification specs: reading a user's notifications,
// mention markup as the editor serializes it, and browser contexts for the
// throwaway users of a World.

export type AppNotification = {
  id: string;
  userId: string;
  type: string;
  title: string | null;
  content: string | null;
  isRead: boolean | null;
  resourceId: string | null;
  resourceType: string | null;
  workspaceId?: string | null;
  actorId?: string | null;
  eventData?: Record<string, unknown> | null;
  createdAt: string;
};

export async function listNotifications(
  ctx: APIRequestContext,
): Promise<AppNotification[]> {
  return expectJson<AppNotification[]>(await ctx.get("/api/notification"));
}

/** Poll the user's notifications until one matches. */
export function waitForNotification(
  ctx: APIRequestContext,
  predicate: (notification: AppNotification) => boolean,
  what = "a notification",
): Promise<AppNotification> {
  return eventually(
    async () => (await listNotifications(ctx)).find(predicate),
    { what },
  );
}

/**
 * Create a notification for the user itself and wait until it is listed:
 * event-driven notifications raised before it have had time to land, so a
 * missing one really is missing.
 */
export async function settle(ctx: APIRequestContext): Promise<void> {
  const sentinel = await expectJson<{ id: string }>(
    await ctx.post("/api/notification", {
      data: { title: "e2e sentinel", message: "sentinel", type: "system" },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 750));
  await waitForNotification(
    ctx,
    (entry) => entry.id === sentinel.id,
    "the sentinel",
  );
}

/** A mention exactly as the rich-text editor serializes it. */
export function mention(user: Pick<TestUser, "id" | "name">): string {
  return `<margaya-mention id="${user.id}" label="${user.name}"></margaya-mention>`;
}

/** A browser context signed in as a World user (their API session cookie). */
export async function browserContextFor(
  browser: Browser,
  user: TestUser,
): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: E2E_WEB_URL,
    locale: "en-US",
    storageState: await user.ctx.storageState(),
  });
}

/**
 * Poll MailPit for a message to `to` whose subject contains `subject`, sent
 * at or after `since`, and whose text passes `matches` (several emails can
 * share one subject).
 */
export function waitForMail(
  mailpit: MailpitClient,
  options: { to: string; subject: string; since: Date; timeoutMs?: number },
  matches: (message: MailpitMessage) => boolean,
): Promise<MailpitMessage> {
  return eventually(
    async () => {
      const summaries = await mailpit.search(
        `to:${options.to} subject:"${options.subject.replaceAll('"', "")}"`,
      );
      for (const summary of summaries) {
        if (new Date(summary.Created).getTime() < options.since.getTime())
          continue;
        const message = await mailpit.getMessage(summary.ID);
        if (matches(message)) return message;
      }
      return undefined;
    },
    {
      timeoutMs: options.timeoutMs ?? 20_000,
      intervalMs: 500,
      what: `an email "${options.subject}" to ${options.to}`,
    },
  );
}

/**
 * How long browser steps may wait for the web app. The Vite dev server on
 * :5174 compiles modules on demand and slows down a lot while other suites
 * hit it, so page loads can take tens of seconds.
 */
export const UI_TIMEOUT = 90_000;

/** Open an app URL without waiting for every dev-server module to settle. */
export async function openApp(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: UI_TIMEOUT });
}
