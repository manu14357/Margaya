import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import createDiscordIntegration from "./discord-integration/create-discord-integration";
import deleteDiscordIntegration from "./discord-integration/delete-discord-integration";
import getDiscordIntegration from "./discord-integration/get-discord-integration";
import updateDiscordIntegration from "./discord-integration/update-discord-integration";
import createGenericWebhookIntegration from "./generic-webhook-integration/create-generic-webhook-integration";
import deleteGenericWebhookIntegration from "./generic-webhook-integration/delete-generic-webhook-integration";
import getGenericWebhookIntegration from "./generic-webhook-integration/get-generic-webhook-integration";
import updateGenericWebhookIntegration from "./generic-webhook-integration/update-generic-webhook-integration";
import createMattermostIntegration from "./mattermost-integration/create-mattermost-integration";
import deleteMattermostIntegration from "./mattermost-integration/delete-mattermost-integration";
import getMattermostIntegration from "./mattermost-integration/get-mattermost-integration";
import updateMattermostIntegration from "./mattermost-integration/update-mattermost-integration";
import createSlackIntegration from "./slack-integration/create-slack-integration";
import deleteSlackIntegration from "./slack-integration/delete-slack-integration";
import getSlackIntegration from "./slack-integration/get-slack-integration";
import updateSlackIntegration from "./slack-integration/update-slack-integration";
import createTelegramIntegration from "./telegram-integration/create-telegram-integration";
import deleteTelegramIntegration from "./telegram-integration/delete-telegram-integration";
import getTelegramIntegration from "./telegram-integration/get-telegram-integration";
import updateTelegramIntegration from "./telegram-integration/update-telegram-integration";

const KEYS = [
  "discord-integration",
  "generic-webhook-integration",
  "mattermost-integration",
  "slack-integration",
  "telegram-integration",
] as const;

const { routes } = vi.hoisted(() => {
  const route = () => ({
    $get: vi.fn(),
    $post: vi.fn(),
    $patch: vi.fn(),
    $delete: vi.fn(),
  });
  return {
    routes: {
      "discord-integration": route(),
      "generic-webhook-integration": route(),
      "mattermost-integration": route(),
      "slack-integration": route(),
      "telegram-integration": route(),
    },
  };
});

vi.mock("@margaya/libs", () => ({
  client: Object.fromEntries(
    Object.entries(routes).map(([key, route]) => [
      key,
      { project: { ":projectId": route } },
    ]),
  ),
}));

const integration = { id: "int-1", projectId: "p1" };

const fetchers = {
  "discord-integration": {
    get: getDiscordIntegration,
    create: createDiscordIntegration,
    update: updateDiscordIntegration,
    remove: deleteDiscordIntegration,
    createBody: { webhookUrl: "https://discord.example/hook" },
  },
  "generic-webhook-integration": {
    get: getGenericWebhookIntegration,
    create: createGenericWebhookIntegration,
    update: updateGenericWebhookIntegration,
    remove: deleteGenericWebhookIntegration,
    createBody: { webhookUrl: "https://hooks.example/in" },
  },
  "mattermost-integration": {
    get: getMattermostIntegration,
    create: createMattermostIntegration,
    update: updateMattermostIntegration,
    remove: deleteMattermostIntegration,
    createBody: { webhookUrl: "https://mm.example/hooks/x" },
  },
  "slack-integration": {
    get: getSlackIntegration,
    create: createSlackIntegration,
    update: updateSlackIntegration,
    remove: deleteSlackIntegration,
    createBody: { webhookUrl: "https://hooks.slack.example/x" },
  },
  "telegram-integration": {
    get: getTelegramIntegration,
    create: createTelegramIntegration,
    update: updateTelegramIntegration,
    remove: deleteTelegramIntegration,
    createBody: { botToken: "123:abc", chatId: "-100" },
  },
} as const;

beforeEach(() => {
  for (const key of KEYS) {
    for (const fn of Object.values(routes[key])) fn.mockReset();
  }
});

describe.each(KEYS)("%s fetchers", (key) => {
  const route = () => routes[key];
  const f = fetchers[key];

  it("reads the project's integration, including null", async () => {
    route().$get.mockResolvedValueOnce(Response.json(integration));
    await expect(f.get("p1")).resolves.toEqual(integration);
    route().$get.mockResolvedValueOnce(Response.json(null));
    await expect(f.get("p1")).resolves.toBeNull();
    expect(route().$get).toHaveBeenCalledWith({ param: { projectId: "p1" } });
  });

  it("creates, updates and deletes with the project param and JSON body", async () => {
    route().$post.mockResolvedValueOnce(Response.json(integration));
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: one table for five request types
      f.create("p1", f.createBody as any),
    ).resolves.toEqual(integration);
    expect(route().$post).toHaveBeenCalledWith({
      param: { projectId: "p1" },
      json: f.createBody,
    });

    route().$patch.mockResolvedValueOnce(Response.json(integration));
    await f.update("p1", { isActive: false });
    expect(route().$patch).toHaveBeenCalledWith({
      param: { projectId: "p1" },
      json: { isActive: false },
    });

    route().$delete.mockResolvedValueOnce(Response.json({ success: true }));
    await expect(f.remove("p1")).resolves.toEqual({ success: true });
    expect(route().$delete).toHaveBeenCalledWith({
      param: { projectId: "p1" },
    });
  });

  it("throws HttpError with the status and body text", async () => {
    route().$patch.mockResolvedValueOnce(
      new Response("Integration not found", { status: 404 }),
    );
    const error = await f.update("p1", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      status: 404,
      message: "Integration not found",
    });
  });
});

describe("telegram read", () => {
  it("treats a 404 as no integration", async () => {
    routes["telegram-integration"].$get.mockResolvedValueOnce(
      new Response("missing", { status: 404 }),
    );
    await expect(getTelegramIntegration("p1")).resolves.toBeNull();
  });

  it("still throws on other failures", async () => {
    routes["telegram-integration"].$get.mockResolvedValueOnce(
      new Response("forbidden", { status: 403 }),
    );
    await expect(getTelegramIntegration("p1")).rejects.toMatchObject({
      status: 403,
    });
  });
});
