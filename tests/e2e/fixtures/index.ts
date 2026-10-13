import {
  type APIRequestContext,
  test as base,
  type Page,
} from "@playwright/test";
import { authFile, loadSeedManifest } from "../helpers/auth";
import { E2E_API_URL, E2E_WEB_URL } from "../helpers/env";
import { createApiContext } from "../helpers/http";
import { MailpitClient } from "../helpers/mailpit";
import { startWebhookSink, type WebhookSink } from "../helpers/webhook-sink";
import type { Role } from "../seed/data";
import type { SeedManifest } from "../seed/seed";

export type Actor = Role | "anonymous";

const EMPTY_STATE = { cookies: [], origins: [] };

type Fixtures = {
  /** Ids and names of the seeded workspace, users, projects, tasks and more. */
  seed: SeedManifest;
  /** Public API client signed in as the workspace owner (baseURL = API origin). */
  api: APIRequestContext;
  /** Public API client for any seeded role, or signed out with "anonymous". */
  apiAs: (actor: Actor) => Promise<APIRequestContext>;
  /** A page in a fresh browser context signed in as `actor`, for multi-user specs. */
  pageAs: (actor: Actor) => Promise<Page>;
  /** Reads the emails the API sent (MailPit). */
  mailpit: MailpitClient;
  /** A local HTTP receiver for outgoing webhooks, closed after the test. */
  webhookSink: WebhookSink;
};

function storageStateFor(actor: Actor) {
  return actor === "anonymous" ? EMPTY_STATE : authFile(actor);
}

export const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
  seed: async ({}, use) => {
    await use(loadSeedManifest());
  },

  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
  apiAs: async ({}, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async (actor) => {
      const context = await createApiContext({
        apiURL: E2E_API_URL,
        clientURL: E2E_WEB_URL,
        storageState: storageStateFor(actor),
      });
      contexts.push(context);
      return context;
    });
    await Promise.all(contexts.map((context) => context.dispose()));
  },

  api: async ({ apiAs }, use) => {
    await use(await apiAs("owner"));
  },

  pageAs: async ({ browser, locale, timezoneId }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await use(async (actor) => {
      const context = await browser.newContext({
        baseURL: E2E_WEB_URL,
        locale,
        timezoneId,
        storageState: storageStateFor(actor),
      });
      contexts.push(context);
      return context.newPage();
    });
    await Promise.all(contexts.map((context) => context.close()));
  },

  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
  mailpit: async ({}, use) => {
    await use(new MailpitClient());
  },

  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
  webhookSink: async ({}, use) => {
    const sink = await startWebhookSink();
    await use(sink);
    await sink.close();
  },
});

/** Spread into test.use() for specs that start signed out. */
export const asAnonymous = { storageState: EMPTY_STATE };

/** Spread into test.use() to browse as a seeded role. */
export function asRole(role: Role) {
  return { storageState: authFile(role) };
}

export { expect } from "@playwright/test";
