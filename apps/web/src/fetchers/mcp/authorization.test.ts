import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMcpAuthorizationRequest } from "./get-authorization-request";
import { submitMcpAuthorizationDecision } from "./submit-authorization-decision";

const { route } = vi.hoisted(() => ({
  route: { $get: vi.fn(), $post: vi.fn() },
}));
vi.mock("@margaya/libs", () => ({
  client: { mcp: { authorize: { request: { ":requestId": route } } } },
}));

beforeEach(() => {
  route.$get.mockReset();
  route.$post.mockReset();
});

describe("MCP consent fetchers", () => {
  it("reads a request with an encoded id and maps its fields", async () => {
    route.$get.mockResolvedValueOnce(
      Response.json({
        client_name: "Editor",
        redirect_uri: "http://127.0.0.1:3000/cb",
      }),
    );
    await expect(getMcpAuthorizationRequest("a/b c")).resolves.toEqual({
      clientName: "Editor",
      redirectUri: "http://127.0.0.1:3000/cb",
    });
    expect(route.$get).toHaveBeenCalledWith({
      param: { requestId: "a%2Fb%20c" },
    });
  });

  it("reports an unknown request with a fixed message", async () => {
    route.$get.mockResolvedValueOnce(
      Response.json({ error: "invalid_request" }, { status: 404 }),
    );
    await expect(getMcpAuthorizationRequest("gone")).rejects.toThrow(
      "This authorization request is invalid or has expired.",
    );
  });

  it("posts the decision and returns the redirect", async () => {
    route.$post.mockResolvedValueOnce(
      Response.json({ redirect: "http://127.0.0.1:3000/cb?code=x" }),
    );
    await expect(submitMcpAuthorizationDecision("r1", true)).resolves.toBe(
      "http://127.0.0.1:3000/cb?code=x",
    );
    expect(route.$post).toHaveBeenCalledWith({
      param: { requestId: "r1" },
      json: { approved: true },
    });
  });

  it("reports a failed decision with a fixed message", async () => {
    route.$post.mockResolvedValueOnce(new Response("no", { status: 403 }));
    await expect(submitMcpAuthorizationDecision("r1", false)).rejects.toThrow(
      "Could not complete the authorization request.",
    );
  });
});
