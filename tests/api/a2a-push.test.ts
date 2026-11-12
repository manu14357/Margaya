import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../apps/api/src/database", () => ({ default: {} }));
vi.mock("../../apps/api/src/events", () => ({
  subscribeToEvent: vi.fn(async () => {}),
  publishEvent: vi.fn(async () => {}),
}));

const { assertPushUrl, parsePushConfig, pushBody, pushConfigView } =
  await import("../../apps/api/src/a2a/push");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("A2A push configs", () => {
  it("reads flat and nested configs and refuses bad ones", () => {
    expect(
      parsePushConfig({ url: "https://h.example/x", token: "t" }),
    ).toMatchObject({
      url: "https://h.example/x",
      token: "t",
    });
    expect(
      parsePushConfig({
        pushNotificationConfig: { url: "https://h.example/y" },
      }),
    ).toMatchObject({ url: "https://h.example/y" });
    expect(() => parsePushConfig({})).toThrow("Invalid push config");
    expect(() =>
      parsePushConfig({
        url: "https://h.example/x",
        authentication: { scheme: "Bearer token" },
      }),
    ).toThrow();
  });

  it("allows only public https endpoints", async () => {
    await expect(assertPushUrl("http://h.example/x")).rejects.toThrow("https");
    await expect(assertPushUrl("https://u:p@h.example/x")).rejects.toThrow();
    await expect(assertPushUrl("https://h.example/x#f")).rejects.toThrow();
    await expect(assertPushUrl("https://10.1.2.3/x")).rejects.toThrow("public");
    await expect(assertPushUrl("https://[::1]/x")).rejects.toThrow("public");
    await expect(assertPushUrl("not a url")).rejects.toThrow(
      "Invalid push URL",
    );
  });

  it("sends only the new state, and shows configs without secrets", () => {
    expect(
      pushBody(
        { id: "t1", contextId: "c1" },
        "TASK_STATE_COMPLETED",
        new Date(0),
      ),
    ).toEqual({
      statusUpdate: {
        taskId: "t1",
        contextId: "c1",
        status: {
          state: "TASK_STATE_COMPLETED",
          timestamp: "1970-01-01T00:00:00.000Z",
        },
      },
    });
    const view = pushConfigView({
      id: "p1",
      a2aTaskId: "t1",
      url: "https://h.example/x",
      tokenSealed: "sbx:v1:sealed",
      authScheme: "Bearer",
      authCredentialsSealed: "sbx:v1:sealed",
    } as Parameters<typeof pushConfigView>[0]);
    expect(view).toEqual({
      id: "p1",
      taskId: "t1",
      url: "https://h.example/x",
      authentication: { scheme: "Bearer" },
    });
  });
});
