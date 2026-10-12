import { beforeEach, describe, expect, it } from "vitest";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { addWorkspaceMember, createWorkspaceMember } from "./helpers/fixtures";
import {
  addSecondWorkspace,
  expectStatus,
  homeContext,
  json,
  type StickyJson,
  type StickyPageJson,
} from "./helpers/home";

describe("API integration: sticky access", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function ownerWithSticky() {
    const ctx = await homeContext();
    const response = await expectStatus(
      ctx.app.request(
        "/api/sticky",
        json("POST", { workspaceId: ctx.workspaceId, content: "private" }),
      ),
      200,
    );
    return { ...ctx, sticky: (await response.json()) as StickyJson };
  }

  it("hides a member's stickies from every other member, admins included", async () => {
    const { app, sticky, workspaceId } = await ownerWithSticky();

    for (const role of ["member", "admin", "owner"]) {
      mockAuthenticatedSession(await addWorkspaceMember(workspaceId, role));
      await expectStatus(
        app.request(
          `/api/sticky/${sticky.id}?workspaceId=${workspaceId}`,
          json("PATCH", { content: "hacked" }),
        ),
        404,
        "Sticky not found",
      );
      await expectStatus(
        app.request(`/api/sticky/${sticky.id}?workspaceId=${workspaceId}`, {
          method: "DELETE",
        }),
        404,
        "Sticky not found",
      );
      const list = (await (
        await expectStatus(
          app.request(`/api/sticky?workspaceId=${workspaceId}`),
          200,
        )
      ).json()) as StickyPageJson;
      expect(list.items).toEqual([]);
      await expectStatus(
        app.request(
          `/api/sticky/reorder?workspaceId=${workspaceId}`,
          json("PUT", { stickyIds: [sticky.id] }),
        ),
        400,
        `Sticky ${sticky.id} does not belong to you`,
      );
    }
  });

  it("scopes a sticky to its workspace", async () => {
    const { app, sticky, user } = await ownerWithSticky();
    const otherWorkspaceId = await addSecondWorkspace(user);
    await expectStatus(
      app.request(
        `/api/sticky/${sticky.id}?workspaceId=${otherWorkspaceId}`,
        json("PATCH", { color: "red" }),
      ),
      404,
    );

    const stranger = await createWorkspaceMember();
    await expectStatus(
      app.request(
        `/api/sticky/${sticky.id}?workspaceId=${stranger.workspace.id}`,
        { method: "DELETE" },
      ),
      403,
    );
  });

  it("lets a viewer manage their own stickies", async () => {
    const { app, workspaceId } = await homeContext("viewer");
    const created = (await (
      await expectStatus(
        app.request("/api/sticky", json("POST", { workspaceId })),
        200,
      )
    ).json()) as StickyJson;
    await expectStatus(
      app.request(
        `/api/sticky/${created.id}?workspaceId=${workspaceId}`,
        json("PATCH", { content: "mine" }),
      ),
      200,
    );
    await expectStatus(
      app.request(
        `/api/sticky/reorder?workspaceId=${workspaceId}`,
        json("PUT", { stickyIds: [created.id] }),
      ),
      200,
    );
    await expectStatus(
      app.request(`/api/sticky/${created.id}?workspaceId=${workspaceId}`, {
        method: "DELETE",
      }),
      200,
    );
  });

  it("refuses non-members and anonymous callers", async () => {
    const { app, workspaceId } = await homeContext();
    const outsider = await createWorkspaceMember();
    mockAuthenticatedSession(outsider.user);
    await expectStatus(
      app.request(`/api/sticky?workspaceId=${workspaceId}`),
      403,
    );
    await expectStatus(
      app.request("/api/sticky", json("POST", { workspaceId })),
      403,
    );

    mockAnonymousSession();
    await expectStatus(
      app.request(`/api/sticky?workspaceId=${workspaceId}`),
      401,
    );
  });
});
