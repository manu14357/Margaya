import { createHmac, hkdfSync } from "node:crypto";
import { expect, test } from "../../fixtures";
import {
  createApiKey,
  createProject,
  createWorld,
  deleteApiKey,
  expectJson,
  expectStatus,
  headerContext,
  type Project,
  signUpUser,
  type TestUser,
  type World,
} from "../../helpers/api-kit";
import { apiServerEnv } from "../../helpers/env";
import { covers } from "../../helpers/openapi";

// The two-way chat app of a workspace: its settings (credentials stored
// sealed, returned masked) and each person's account links. Nothing here may
// reach the chat service: the connection uses HTTP mode, which opens no
// socket, with made-up credentials, and the test route is only called where
// it answers before dialling out (no connection, no permission). The account
// link prompt's token is signed with a key derived from the e2e AUTH_SECRET,
// so the spec mints one the way the server's slash command would.

type Connection = {
  id: string;
  workspaceId: string;
  mode: "socket" | "http";
  teamId: string | null;
  teamName: string | null;
  botTokenConfigured: boolean;
  maskedBotToken: string;
  appTokenConfigured: boolean;
  maskedAppToken: string;
  signingSecretConfigured: boolean;
  maskedSigningSecret: string;
  credentialsReadable: boolean;
  defaultProjectId: string | null;
  expandTaskKeys: boolean;
  isActive: boolean;
  lastError: string | null;
};
type AppState = {
  connection: Connection | null;
  setup: {
    eventsUrl: string;
    unfurlDomain: string | null;
    manifests: { socket: string; http: string };
  };
};
type Link = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  slackTeamId: string;
  teamName: string | null;
  slackUserId: string;
  slackUserName: string | null;
  createdAt: string;
};
type LinkPreview = {
  workspaceId: string;
  workspaceName: string;
  teamName: string | null;
  slackUserName: string | null;
  linkedToYou: boolean;
  linkedToSomeoneElse: boolean;
};

const BOT_TOKEN = "xoxb-e2e-0000000000-fake-bot-token-a1b2";
const SIGNING_SECRET = "e2eSigningSecretNotReal0000c3d4";

let world: World;
let project: Project;
let otherWorld: World;
let outsider: TestUser;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Slack app");
  project = await createProject(world.as("owner"), world.workspace.id);
  otherWorld = await createWorld("Slack app other");
  outsider = await signUpUser("Slack app outsider");
});

test.afterAll(async () => {
  await world
    ?.as("owner")
    .delete(`/api/slack-app/workspace/${world.workspace.id}`)
    .catch(() => undefined);
  await world?.dispose();
  await otherWorld?.dispose();
  await outsider?.ctx.dispose();
});

/** A link prompt token as the server signs it (slack-app/link-token.ts). */
function mintLinkToken(claims: {
  workspaceId: string;
  teamId: string;
  slackUserId: string;
  slackUserName: string | null;
  expiresInSeconds?: number;
}): string {
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      apiServerEnv.AUTH_SECRET as string,
      "margaya-secret-box",
      "margaya:slack-link-token:v1",
      32,
    ),
  );
  const payload = Buffer.from(
    JSON.stringify({
      w: claims.workspaceId,
      t: claims.teamId,
      u: claims.slackUserId,
      n: claims.slackUserName,
      e: Math.floor(Date.now() / 1000) + (claims.expiresInSeconds ?? 600),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", key)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

const base = () => `/api/slack-app/workspace/${world.workspace.id}`;

test(
  "settings: setup details for managers only, nothing connected yet",
  covers("getSlackApp", "testSlackApp", "updateSlackApp", "disconnectSlackApp"),
  async () => {
    const state = await expectJson<AppState>(
      await world.as("admin").get(base()),
    );
    expect(state.connection).toBeNull();
    expect(state.setup.eventsUrl).toContain(world.workspace.id);
    for (const manifest of Object.values(state.setup.manifests)) {
      expect(() => JSON.parse(manifest)).not.toThrow();
    }
    expect(JSON.parse(state.setup.manifests.socket)).not.toEqual(
      JSON.parse(state.setup.manifests.http),
    );

    for (const actor of ["member", "viewer"] as const) {
      await expectStatus(await world.as(actor).get(base()), 403);
    }
    await expectStatus(await world.as("anonymous").get(base()), 401);
    // Another workspace's owner gets nothing either.
    await expectStatus(await otherWorld.as("owner").get(base()), [403, 404]);

    // Nothing to update, test or remove yet.
    await expectStatus(
      await world.as("owner").patch(base(), { data: { isActive: false } }),
      404,
    );
    await expectStatus(await world.as("owner").post(`${base()}/test`), 404);
    await expectStatus(await world.as("owner").delete(base()), 404);
  },
);

test(
  "connect: credentials are checked for shape and the mode; members are refused",
  covers("connectSlackApp"),
  async () => {
    const owner = world.as("owner");
    const refused: Record<string, unknown>[] = [
      // Socket Mode (the default) needs an app-level token.
      { botToken: BOT_TOKEN },
      // HTTP mode needs the signing secret.
      { mode: "http", botToken: BOT_TOKEN },
      {
        mode: "http",
        botToken: "xoxp-user-token",
        signingSecret: SIGNING_SECRET,
      },
      { mode: "http", botToken: BOT_TOKEN, signingSecret: "short" },
      { mode: "socket", botToken: BOT_TOKEN, appToken: "not-an-app-token" },
      { mode: "pigeon", botToken: BOT_TOKEN, signingSecret: SIGNING_SECRET },
      {},
    ];
    for (const data of refused) {
      await expectStatus(await owner.post(base(), { data }), 400);
    }
    // A default project must belong to the workspace.
    const foreign = await createProject(
      otherWorld.as("owner"),
      otherWorld.workspace.id,
    );
    await expectStatus(
      await owner.post(base(), {
        data: {
          mode: "http",
          botToken: BOT_TOKEN,
          signingSecret: SIGNING_SECRET,
          defaultProjectId: foreign.id,
        },
      }),
      400,
    );
    for (const actor of ["member", "viewer"] as const) {
      await expectStatus(
        await world.as(actor).post(base(), {
          data: {
            mode: "http",
            botToken: BOT_TOKEN,
            signingSecret: SIGNING_SECRET,
          },
        }),
        403,
      );
    }
    expect(
      (await expectJson<AppState>(await owner.get(base()))).connection,
    ).toBeNull();

    const state = await expectJson<AppState>(
      await world.as("admin").post(base(), {
        data: {
          mode: "http",
          botToken: BOT_TOKEN,
          signingSecret: SIGNING_SECRET,
          defaultProjectId: project.id,
        },
      }),
    );
    expect(state.connection).toMatchObject({
      workspaceId: world.workspace.id,
      mode: "http",
      teamId: null,
      teamName: null,
      botTokenConfigured: true,
      maskedBotToken: "xoxb-…a1b2",
      appTokenConfigured: false,
      maskedAppToken: "",
      signingSecretConfigured: true,
      credentialsReadable: true,
      defaultProjectId: project.id,
      expandTaskKeys: false,
      isActive: true,
    });
    // Credentials never come back.
    const raw = JSON.stringify(state);
    expect(raw).not.toContain(BOT_TOKEN);
    expect(raw).not.toContain(SIGNING_SECRET);
    expect(
      JSON.stringify(await expectJson(await owner.get(base()))),
    ).not.toContain(BOT_TOKEN);
  },
);

test(
  "update: omitted fields keep their value; mode changes need their credential",
  covers("updateSlackApp", "getSlackApp"),
  async () => {
    const owner = world.as("owner");
    const before = await expectJson<AppState>(await owner.get(base()));
    const updated = await expectJson<AppState>(
      await owner.patch(base(), {
        data: { expandTaskKeys: true, defaultProjectId: null, isActive: false },
      }),
    );
    expect(updated.connection).toMatchObject({
      mode: "http",
      expandTaskKeys: true,
      defaultProjectId: null,
      isActive: false,
      botTokenConfigured: true,
      maskedBotToken: "xoxb-…a1b2",
      signingSecretConfigured: true,
    });
    // The manifest follows the task key previews switch.
    expect(updated.setup.manifests.http).not.toBe(before.setup.manifests.http);

    // Socket Mode without a stored app-level token is refused and changes
    // nothing.
    await expectStatus(
      await owner.patch(base(), { data: { mode: "socket" } }),
      400,
    );
    await expectStatus(
      await owner.patch(base(), { data: { botToken: "bad" } }),
      400,
    );
    const foreign = await createProject(
      otherWorld.as("owner"),
      otherWorld.workspace.id,
    );
    await expectStatus(
      await owner.patch(base(), { data: { defaultProjectId: foreign.id } }),
      400,
    );
    await expectStatus(
      await world.as("member").patch(base(), { data: { isActive: true } }),
      403,
    );

    const reactivated = await expectJson<AppState>(
      await world.as("admin").patch(base(), {
        data: { isActive: true, defaultProjectId: project.id },
      }),
    );
    expect(reactivated.connection).toMatchObject({
      mode: "http",
      isActive: true,
      defaultProjectId: project.id,
      expandTaskKeys: true,
    });

    // Only the test route would ask the chat service; it is refused before
    // that for members.
    await expectStatus(await world.as("member").post(`${base()}/test`), 403);
    await expectStatus(await world.as("viewer").post(`${base()}/test`), 403);
    await expectStatus(await world.as("anonymous").post(`${base()}/test`), 401);
  },
);

test(
  "account links: preview, confirm, list and unlink, as each person's own",
  covers(
    "previewSlackLink",
    "confirmSlackLink",
    "listSlackLinks",
    "deleteSlackLink",
  ),
  async () => {
    const viewer = world.users.viewer;
    expect(
      await expectJson<Link[]>(await viewer.ctx.get("/api/slack-app/links")),
    ).toEqual([]);

    const token = mintLinkToken({
      workspaceId: world.workspace.id,
      teamId: "TE2E00001",
      slackUserId: "UE2E00001",
      slackUserName: "e2e.viewer",
    });

    const preview = await expectJson<LinkPreview>(
      await viewer.ctx.post("/api/slack-app/links/preview", {
        data: { token },
      }),
    );
    expect(preview).toEqual({
      workspaceId: world.workspace.id,
      workspaceName: world.workspace.name,
      teamName: null,
      slackUserName: "e2e.viewer",
      linkedToYou: false,
      linkedToSomeoneElse: false,
    });

    // Bad, tampered and expired tokens read the same.
    const [payload, signature] = token.split(".");
    for (const bad of [
      "not-a-token",
      `${payload}.${signature?.slice(0, -2)}xx`,
      mintLinkToken({
        workspaceId: world.workspace.id,
        teamId: "TE2E00001",
        slackUserId: "UE2E00001",
        slackUserName: null,
        expiresInSeconds: -60,
      }),
      // A workspace without a connected app.
      mintLinkToken({
        workspaceId: otherWorld.workspace.id,
        teamId: "TE2E00001",
        slackUserId: "UE2E00001",
        slackUserName: null,
      }),
    ]) {
      await expectStatus(
        await otherWorld.users.owner.ctx.post("/api/slack-app/links/preview", {
          data: { token: bad },
        }),
        400,
      );
    }
    // Only members of the workspace can link.
    await expectStatus(
      await outsider.ctx.post("/api/slack-app/links/preview", {
        data: { token },
      }),
      [403, 404],
    );
    await expectStatus(
      await outsider.ctx.post("/api/slack-app/links", { data: { token } }),
      [403, 404],
    );
    await expectStatus(
      await viewer.ctx.post("/api/slack-app/links", { data: { token: "" } }),
      400,
    );
    await expectStatus(
      await world.as("anonymous").post("/api/slack-app/links", {
        data: { token },
      }),
      401,
    );
    // A session is required: API keys can't link an account.
    const key = await createApiKey(viewer.ctx);
    const viaKey = await headerContext({ "x-api-key": key.key });
    try {
      await expectStatus(
        await viaKey.post("/api/slack-app/links/preview", { data: { token } }),
        403,
      );
      await expectStatus(
        await viaKey.post("/api/slack-app/links", { data: { token } }),
        403,
      );
    } finally {
      await viaKey.dispose();
      await deleteApiKey(viewer.ctx, key.id);
    }

    const link = await expectJson<Link>(
      await viewer.ctx.post("/api/slack-app/links", { data: { token } }),
    );
    expect(link).toMatchObject({
      workspaceId: world.workspace.id,
      workspaceName: world.workspace.name,
      slackTeamId: "TE2E00001",
      slackUserId: "UE2E00001",
      slackUserName: "e2e.viewer",
      teamName: null,
    });
    expect(
      await expectJson<LinkPreview>(
        await viewer.ctx.post("/api/slack-app/links/preview", {
          data: { token },
        }),
      ),
    ).toMatchObject({ linkedToYou: true, linkedToSomeoneElse: false });

    // The same chat user confirmed by someone else moves to them.
    const member = world.users.member;
    expect(
      await expectJson<LinkPreview>(
        await member.ctx.post("/api/slack-app/links/preview", {
          data: { token },
        }),
      ),
    ).toMatchObject({ linkedToYou: false, linkedToSomeoneElse: true });
    const moved = await expectJson<Link>(
      await member.ctx.post("/api/slack-app/links", { data: { token } }),
    );
    expect(moved.id).toBe(link.id);
    expect(
      await expectJson<Link[]>(await viewer.ctx.get("/api/slack-app/links")),
    ).toEqual([]);
    const memberLinks = await expectJson<Link[]>(
      await member.ctx.get("/api/slack-app/links"),
    );
    expect(memberLinks.map((entry) => entry.id)).toEqual([link.id]);

    // Disconnecting the app keeps the links, so reconnecting needs none.
    await expectStatus(await world.as("member").delete(base()), 403);
    expect(await expectJson(await world.as("admin").delete(base()))).toEqual({
      success: true,
    });
    await expectStatus(await world.as("admin").delete(base()), 404);
    expect(
      (await expectJson<AppState>(await world.as("owner").get(base())))
        .connection,
    ).toBeNull();
    expect(
      (
        await expectJson<Link[]>(await member.ctx.get("/api/slack-app/links"))
      ).map((entry) => entry.id),
    ).toEqual([link.id]);

    // Unlinking is the owner's own: someone else's link reads as missing.
    await expectStatus(
      await viewer.ctx.delete(`/api/slack-app/links/${link.id}`),
      404,
    );
    expect(
      await expectJson(
        await member.ctx.delete(`/api/slack-app/links/${link.id}`),
      ),
    ).toEqual({ success: true });
    await expectStatus(
      await member.ctx.delete(`/api/slack-app/links/${link.id}`),
      404,
    );
    expect(
      await expectJson<Link[]>(await member.ctx.get("/api/slack-app/links")),
    ).toEqual([]);
    await expectStatus(
      await world.as("anonymous").get("/api/slack-app/links"),
      401,
    );
  },
);
