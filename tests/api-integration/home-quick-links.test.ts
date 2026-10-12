import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { addWorkspaceMember, createWorkspaceMember } from "./helpers/fixtures";
import {
  collectEvents,
  expectStatus,
  homeContext,
  json,
  type QuickLinkJson,
} from "./helpers/home";

const linkEvents = await collectEvents("quick_link.changed");
const INVALID = "Enter a valid web address (http or https)";
const DUPLICATE = "This link is already in your quick links";

async function quickLinks(role = "member") {
  const ctx = await homeContext(role);
  const { app, workspaceId } = ctx;
  const create = (body: Record<string, unknown>) =>
    app.request("/api/quick-link", json("POST", { workspaceId, ...body }));
  const createOk = async (body: Record<string, unknown>) =>
    (await (await expectStatus(create(body), 200)).json()) as QuickLinkJson;
  const patch = (id: string, body: unknown) =>
    app.request(
      `/api/quick-link/${id}?workspaceId=${workspaceId}`,
      json("PATCH", body),
    );
  const remove = (id: string) =>
    app.request(`/api/quick-link/${id}?workspaceId=${workspaceId}`, {
      method: "DELETE",
    });
  const list = async () =>
    (await (
      await expectStatus(
        app.request(`/api/quick-link?workspaceId=${workspaceId}`),
        200,
      )
    ).json()) as QuickLinkJson[];
  return { ...ctx, create, createOk, patch, remove, list };
}

describe("API integration: quick links", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    linkEvents.length = 0;
  });

  it("normalizes URLs and titles", async () => {
    const { createOk } = await quickLinks();
    expect(
      await createOk({ url: "example.com/docs", title: "  Docs  " }),
    ).toMatchObject({ url: "https://example.com/docs", title: "Docs" });
    expect(
      await createOk({ url: "https://EXAMPLE.org/Path", title: "   " }),
    ).toMatchObject({ url: "https://example.org/Path", title: null });
  });

  it("rejects unsafe or invalid URLs", async () => {
    const { create } = await quickLinks();
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "ftp://example.com/file",
      "https://ada:secret@example.com",
      "https://",
      `example.com/${"a".repeat(2_030)}`,
    ]) {
      await expectStatus(create({ url }), 400, INVALID);
    }
    await expectStatus(create({ url: "" }), 400);
    await expectStatus(
      create({ url: "example.com", title: "t".repeat(256) }),
      400,
    );
  });

  it("refuses duplicates after normalization", async () => {
    const { create, createOk, patch } = await quickLinks();
    const first = await createOk({ url: "https://example.com/a" });
    await expectStatus(create({ url: "EXAMPLE.com/a" }), 409, DUPLICATE);

    const second = await createOk({ url: "example.com/b" });
    await expectStatus(
      patch(second.id, { url: "example.com/a" }),
      409,
      DUPLICATE,
    );
    const renamed = (await (
      await expectStatus(
        patch(first.id, { url: "https://example.com/a", title: "A" }),
        200,
      )
    ).json()) as QuickLinkJson;
    expect(renamed).toMatchObject({ url: "https://example.com/a", title: "A" });
  });

  it("lists newest first", async () => {
    const { createOk, list } = await quickLinks();
    const a = await createOk({ url: "a.example.com" });
    const b = await createOk({ url: "b.example.com" });
    const c = await createOk({ url: "c.example.com" });
    expect((await list()).map((link) => link.id)).toEqual([c.id, b.id, a.id]);
  });

  it("updates, clears titles and skips unchanged writes", async () => {
    const { createOk, patch } = await quickLinks();
    const link = await createOk({ url: "example.com", title: "Home" });
    linkEvents.length = 0;

    const cleared = (await (
      await expectStatus(patch(link.id, { title: null }), 200)
    ).json()) as QuickLinkJson;
    expect(cleared.title).toBeNull();
    expect(linkEvents).toHaveLength(1);

    linkEvents.length = 0;
    await expectStatus(patch(link.id, { title: "  " }), 200);
    await expectStatus(patch(link.id, { url: "https://example.com/" }), 200);
    expect(linkEvents).toEqual([]);

    await expectStatus(
      patch(link.id, {}),
      400,
      "Provide a url or title to update",
    );
    await expectStatus(patch(link.id, { position: 1 }), 400);
    await expectStatus(
      patch(link.id, { url: "ftp://x.example" }),
      400,
      INVALID,
    );
  });

  it("caps quick links at 50 per user and workspace", async () => {
    const { create, user, workspaceId } = await quickLinks();
    await db.insert(schema.quickLinkTable).values(
      Array.from({ length: 50 }, (_, index) => ({
        userId: user.id,
        workspaceId,
        url: `https://example.com/${index}`,
      })),
    );
    await expectStatus(
      create({ url: "example.com/new" }),
      422,
      "You can have up to 50 quick links in this workspace",
    );
    // A duplicate stays 409, even at the cap.
    await expectStatus(create({ url: "example.com/0" }), 409, DUPLICATE);
  });

  it("keeps quick links private to their owner", async () => {
    const { app, createOk, workspaceId } = await quickLinks();
    const link = await createOk({ url: "example.com" });

    for (const role of ["member", "admin"]) {
      mockAuthenticatedSession(await addWorkspaceMember(workspaceId, role));
      await expectStatus(
        app.request(
          `/api/quick-link/${link.id}?workspaceId=${workspaceId}`,
          json("PATCH", { title: "mine now" }),
        ),
        404,
        "Quick link not found",
      );
      await expectStatus(
        app.request(`/api/quick-link/${link.id}?workspaceId=${workspaceId}`, {
          method: "DELETE",
        }),
        404,
      );
      const list = await expectStatus(
        app.request(`/api/quick-link?workspaceId=${workspaceId}`),
        200,
      );
      expect(await list.json()).toEqual([]);
    }
  });

  it("lets a viewer manage their own links and refuses non-members", async () => {
    const { app, createOk, patch, remove, workspaceId } =
      await quickLinks("viewer");
    const link = await createOk({ url: "example.com" });
    await expectStatus(patch(link.id, { title: "Mine" }), 200);
    const removed = await expectStatus(remove(link.id), 200);
    expect(await removed.json()).toEqual({ removed: true });

    const outsider = await createWorkspaceMember();
    mockAuthenticatedSession(outsider.user);
    await expectStatus(
      app.request(`/api/quick-link?workspaceId=${workspaceId}`),
      403,
    );
    await expectStatus(
      app.request(
        "/api/quick-link",
        json("POST", { workspaceId, url: "example.com" }),
      ),
      403,
    );
  });

  it("publishes id-only events", async () => {
    const { createOk, patch, remove, user, workspaceId } = await quickLinks();
    const link = await createOk({ url: "secret.example.com", title: "Plan" });
    await expectStatus(patch(link.id, { title: "Plan B" }), 200);
    await expectStatus(remove(link.id), 200);

    expect(linkEvents.map((event) => event.action)).toEqual([
      "created",
      "updated",
      "deleted",
    ]);
    for (const event of linkEvents) {
      expect(event).toMatchObject({
        userId: user.id,
        workspaceId,
        quickLinkId: link.id,
      });
      expect(Object.keys(event).sort()).toEqual([
        "action",
        "initiatorId",
        "quickLinkId",
        "userId",
        "workspaceId",
      ]);
    }
  });
});
