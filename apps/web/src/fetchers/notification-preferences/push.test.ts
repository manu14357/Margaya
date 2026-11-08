import { beforeEach, describe, expect, it, vi } from "vitest";
import deletePushSubscription from "./delete-push-subscription";
import getPushStatus from "./get-push-status";
import savePushSubscription from "./save-push-subscription";

const { push } = vi.hoisted(() => ({
  push: {
    $get: vi.fn(),
    subscriptions: { $put: vi.fn(), ":id": { $delete: vi.fn() } },
  },
}));
vi.mock("@margaya/libs", () => ({
  client: { "notification-preferences": { push } },
}));

const status = { available: true, publicKey: "k", subscriptions: [] };

beforeEach(() => {
  push.$get.mockReset();
  push.subscriptions.$put.mockReset();
  push.subscriptions[":id"].$delete.mockReset();
});

describe("push fetchers", () => {
  it("reads the status", async () => {
    push.$get.mockResolvedValueOnce(Response.json(status));
    await expect(getPushStatus()).resolves.toEqual(status);
  });

  it("saves a device", async () => {
    const json = {
      endpoint: "https://push.example.com/1",
      keys: { p256dh: "p", auth: "a" },
    };
    push.subscriptions.$put.mockResolvedValueOnce(Response.json(status));
    await expect(savePushSubscription(json)).resolves.toEqual(status);
    expect(push.subscriptions.$put).toHaveBeenCalledWith({ json });
  });

  it("removes a device", async () => {
    push.subscriptions[":id"].$delete.mockResolvedValueOnce(
      Response.json(status),
    );
    await expect(deletePushSubscription("d1")).resolves.toEqual(status);
    expect(push.subscriptions[":id"].$delete).toHaveBeenCalledWith({
      param: { id: "d1" },
    });
  });

  it("throws HttpError with the status and body text", async () => {
    push.$get.mockResolvedValueOnce(new Response("nope", { status: 403 }));
    await expect(getPushStatus()).rejects.toMatchObject({
      status: 403,
      message: "nope",
    });
  });
});
