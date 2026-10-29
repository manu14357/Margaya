import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { getInstanceStatus } from "./get-instance-status";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@margaya/libs", () => ({
  client: { instance: { status: { $get: request } } },
}));

beforeEach(() => request.mockReset());

describe("getInstanceStatus", () => {
  it("returns the status", async () => {
    request.mockResolvedValueOnce(
      Response.json({ hasUsers: true, hasAdmin: false }),
    );
    await expect(getInstanceStatus()).resolves.toEqual({
      hasUsers: true,
      hasAdmin: false,
    });
  });

  it("includes the server's error body in the HttpError", async () => {
    request.mockResolvedValueOnce(new Response(" down \n", { status: 503 }));
    const error = await getInstanceStatus().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      status: 503,
      message: "Failed to fetch instance status: down",
    });
  });

  it("falls back to a generic message for an empty body", async () => {
    request.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(getInstanceStatus()).rejects.toMatchObject({
      status: 500,
      message: "Failed to fetch instance status",
    });
  });
});
