import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { listWorkspaceWhiteboards } from "./whiteboards";

const api = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@margaya/libs", () => ({
  client: {
    whiteboard: {
      workspace: { ":workspaceId": { $get: api.list } },
    },
  },
}));

beforeEach(() => {
  api.list.mockReset();
});

describe("listWorkspaceWhiteboards", () => {
  it("asks for live boards without an empty search", async () => {
    api.list.mockResolvedValue(
      new Response(JSON.stringify({ whiteboards: [] }), { status: 200 }),
    );
    await expect(
      listWorkspaceWhiteboards("w1", { archived: false, q: "  " }),
    ).resolves.toEqual({ whiteboards: [] });
    expect(api.list).toHaveBeenCalledWith({
      param: { workspaceId: "w1" },
      query: { archived: "false" },
    });
  });

  it("sends archived and a trimmed search", async () => {
    api.list.mockResolvedValue(
      new Response(JSON.stringify({ whiteboards: [] }), { status: 200 }),
    );
    await listWorkspaceWhiteboards("w1", { archived: true, q: " retro " });
    expect(api.list).toHaveBeenCalledWith({
      param: { workspaceId: "w1" },
      query: { archived: "true", q: "retro" },
    });
  });

  it("throws an HttpError when the request fails", async () => {
    api.list.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    await expect(
      listWorkspaceWhiteboards("w1", { archived: false, q: "" }),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
