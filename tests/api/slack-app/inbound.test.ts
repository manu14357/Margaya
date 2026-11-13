import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findLinkedUserId, asLinkedUser, callSlack, unlink } = vi.hoisted(
  () => ({
    findLinkedUserId: vi.fn(async (): Promise<string | null> => null),
    asLinkedUser: vi.fn(),
    callSlack: vi.fn(async () => ({ ok: true })),
    unlink: vi.fn(async () => true),
  }),
);

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));
vi.mock("../../../apps/api/src/slack-app/store", () => ({
  findLinkedUserId,
}));
vi.mock("../../../apps/api/src/slack-app/acting-user", () => ({
  asLinkedUser,
}));
vi.mock("../../../apps/api/src/slack-app/links", () => ({
  unlinkSlackIdentity: unlink,
}));
vi.mock("../../../apps/api/src/slack-app/web-api", () => ({
  callSlack,
  respondToSlack: vi.fn(async () => {}),
}));

const {
  handleCommand,
  handleEvent,
  handleInteractive,
  taskKeysIn,
  taskRefFromUrl,
} = await import("../../../apps/api/src/slack-app/inbound");
const { inboundFromHttp } = await import(
  "../../../apps/api/src/slack-app/http"
);
const { inboundFromEnvelope } = await import(
  "../../../apps/api/src/slack-app/socket"
);

const connection = {
  id: "c-1",
  workspaceId: "ws-1",
  mode: "socket" as const,
  botToken: "xoxb-1",
  appToken: "xapp-1",
  signingSecret: null,
  teamId: "T1",
  botUserId: "UBOT",
  defaultProjectId: "p-web",
  expandTaskKeys: true,
  isActive: true,
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "a".repeat(48));
  vi.stubEnv("MARGAYA_CLIENT_URL", "https://pm.example.com");
  findLinkedUserId.mockReset().mockResolvedValue(null);
  asLinkedUser.mockReset();
  callSlack.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("/margaya", () => {
  it("answers help without a link", async () => {
    const reply = await handleCommand(connection, {
      team_id: "T1",
      user_id: "U1",
      text: "",
    });
    expect(reply.response_type).toBe("ephemeral");
    expect(reply.text).toContain("/margaya search");
    expect(asLinkedUser).not.toHaveBeenCalled();
  });

  it("prompts an unlinked user to link, and never acts", async () => {
    const reply = await handleCommand(connection, {
      team_id: "T1",
      user_id: "U1",
      user_name: "ana",
      text: "add Fix login",
    });
    expect(reply.text).toContain("Link your Slack account");
    const link = JSON.stringify(reply.blocks);
    expect(link).toContain(
      "https://pm.example.com/dashboard/settings/account/slack?link=",
    );
    expect(asLinkedUser).not.toHaveBeenCalled();
  });

  it("runs as the linked Margaya user", async () => {
    findLinkedUserId.mockResolvedValue("user-ana");
    const api = vi.fn(async (_method: string, path: string) =>
      path.startsWith("/search")
        ? {
            ok: true,
            status: 200,
            data: {
              results: [
                {
                  id: "t-1",
                  type: "task",
                  title: "Fix <login>",
                  projectId: "p-web",
                  projectName: "Website",
                  projectSlug: "web",
                  taskNumber: 12,
                },
              ],
            },
          }
        : { ok: false, status: 404, message: "Not found" },
    );
    asLinkedUser.mockImplementation(async (_userId, work) => work(api));
    const reply = await handleCommand(connection, {
      team_id: "T1",
      user_id: "U1",
      text: "search login",
    });
    expect(asLinkedUser).toHaveBeenCalledWith("user-ana", expect.any(Function));
    expect(findLinkedUserId).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      teamId: "T1",
      slackUserId: "U1",
    });
    const text = JSON.stringify(reply.blocks);
    expect(text).toContain("WEB-12");
    // Titles are escaped before they reach mrkdwn.
    expect(text).toContain("Fix &lt;login&gt;");
  });

  it("ignores another Slack team", async () => {
    const reply = await handleCommand(connection, {
      team_id: "T-OTHER",
      user_id: "U1",
      text: "search x",
    });
    expect(reply.text).toContain("isn't connected");
    expect(findLinkedUserId).not.toHaveBeenCalled();
  });

  it("unlinks the caller's Slack identity only", async () => {
    const reply = await handleCommand(connection, {
      team_id: "T1",
      user_id: "U1",
      text: "unlink",
    });
    expect(unlink).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      teamId: "T1",
      slackUserId: "U1",
    });
    expect(reply.text).toContain("Unlinked");
  });
});

describe("interactions", () => {
  it("refuses a modal submission without a title before acting", async () => {
    findLinkedUserId.mockResolvedValue("user-ana");
    const result = await handleInteractive(connection, {
      type: "view_submission",
      team: { id: "T1" },
      user: { id: "U1" },
      view: {
        callback_id: "margaya_create_task_modal",
        state: {
          values: {
            title: { value: { value: "  " } },
            project: { value: { selected_option: { value: "p-web" } } },
          },
        },
      },
    });
    expect(result.body).toMatchObject({ response_action: "errors" });
    expect(asLinkedUser).not.toHaveBeenCalled();
  });

  it("runs Assign to me as the clicking user", async () => {
    findLinkedUserId.mockResolvedValue("user-ana");
    const api = vi.fn(async () => ({ ok: true, status: 200, data: {} }));
    asLinkedUser.mockImplementation(async (_userId, work) => work(api));
    await handleInteractive(connection, {
      type: "block_actions",
      team: { id: "T1" },
      user: { id: "U1" },
      response_url: "https://hooks.slack.com/actions/x",
      actions: [{ action_id: "margaya_assign_me", value: "t-1" }],
    });
    await flush();
    expect(api).toHaveBeenCalledWith("PATCH", "/task/assignees/t-1", {
      add: ["user-ana"],
    });
  });
});

describe("events", () => {
  it("unfurls only tasks the poster can see", async () => {
    findLinkedUserId.mockResolvedValue("user-ana");
    // The poster can see nothing: every API call answers 404.
    const api = vi.fn(async () => ({
      ok: false,
      status: 404,
      message: "Not found",
    }));
    asLinkedUser.mockImplementation(async (_userId, work) => work(api));
    await handleEvent(connection, {
      type: "event_callback",
      team_id: "T1",
      event: {
        type: "link_shared",
        user: "U1",
        channel: "C1",
        message_ts: "1.2",
        links: [
          {
            url: "https://pm.example.com/dashboard/workspace/ws-1/task/WEB-12",
          },
        ],
      },
    });
    await flush();
    expect(api).toHaveBeenCalled();
    expect(callSlack).not.toHaveBeenCalled();
  });

  it("never unfurls for an unlinked poster", async () => {
    await handleEvent(connection, {
      type: "event_callback",
      team_id: "T1",
      event: {
        type: "link_shared",
        user: "U1",
        links: [
          {
            url: "https://pm.example.com/dashboard/workspace/ws-1/task/WEB-12",
          },
        ],
      },
    });
    await flush();
    expect(asLinkedUser).not.toHaveBeenCalled();
    expect(callSlack).not.toHaveBeenCalled();
  });

  it("skips bot messages for task key previews", async () => {
    await handleEvent(connection, {
      type: "event_callback",
      team_id: "T1",
      event: { type: "message", bot_id: "B1", text: "WEB-12", user: "U1" },
    });
    await flush();
    expect(findLinkedUserId).not.toHaveBeenCalled();
  });
});

describe("parsing", () => {
  it("recognises task links into this workspace only", () => {
    const web = "https://pm.example.com/margaya";
    expect(
      taskRefFromUrl(
        `${web}/dashboard/workspace/ws-1/project/p-1/task/t-1`,
        "ws-1",
        web,
      ),
    ).toEqual({ taskId: "t-1" });
    expect(
      taskRefFromUrl(
        `${web}/dashboard/workspace/ws-1/task/WEB-12`,
        "ws-1",
        web,
      ),
    ).toEqual({ key: "WEB-12" });
    expect(
      taskRefFromUrl(
        `${web}/dashboard/workspace/ws-1/project/p-1/board?taskId=t-9`,
        "ws-1",
        web,
      ),
    ).toEqual({ taskId: "t-9" });
    expect(
      taskRefFromUrl(
        `${web}/dashboard/workspace/ws-2/task/WEB-12`,
        "ws-1",
        web,
      ),
    ).toBeNull();
    expect(
      taskRefFromUrl(
        "https://evil.example.com/margaya/dashboard/workspace/ws-1/task/WEB-12",
        "ws-1",
        web,
      ),
    ).toBeNull();
  });

  it("finds task keys outside links and code, at most three", () => {
    expect(
      taskKeysIn(
        "WEB-1 and OPS-22, not `CODE-3` or <https://x/WEB-4|WEB-4>, then API-5 and APP-6",
      ),
    ).toEqual(["WEB-1", "OPS-22", "API-5"]);
    expect(taskKeysIn("e-mail and well-2 are not keys")).toEqual([]);
  });

  it("reads HTTP bodies and Socket Mode envelopes the same way", () => {
    expect(
      inboundFromHttp(
        "application/json",
        JSON.stringify({ type: "url_verification", challenge: "abc" }),
      ),
    ).toEqual({ challenge: "abc" });
    expect(
      inboundFromHttp(
        "application/x-www-form-urlencoded",
        "command=%2Fmargaya&text=help&team_id=T1",
      ),
    ).toMatchObject({ kind: "command", payload: { text: "help" } });
    expect(
      inboundFromHttp(
        "application/x-www-form-urlencoded",
        `payload=${encodeURIComponent(JSON.stringify({ type: "block_actions" }))}`,
      ),
    ).toEqual({ kind: "interactive", payload: { type: "block_actions" } });
    expect(
      inboundFromEnvelope({
        envelope_id: "e1",
        type: "slash_commands",
        payload: { text: "help" },
      }),
    ).toEqual({ kind: "command", payload: { text: "help" } });
    expect(
      inboundFromEnvelope({ envelope_id: "e1", type: "hello" }),
    ).toBeNull();
  });
});
