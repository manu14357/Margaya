import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { json, moduleContext } from "./helpers/modules";

const events: Array<Record<string, unknown>> = [];
await subscribeToEvent<Record<string, unknown>>(
  "module.links_changed",
  async (data) => {
    events.push(data);
  },
);

type LinkJson = {
  id: string;
  moduleId: string;
  url: string;
  title: string | null;
  createdBy: string | null;
};

describe("API integration: module links", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    events.length = 0;
  });

  it("creates, lists, updates and deletes normalized links", async () => {
    const { ok, request, createModule, user } = await moduleContext();
    const billing = await createModule({ name: "Billing" });
    const path = `/${billing.id}/links`;

    const spec = await ok<LinkJson>(
      path,
      json("POST", { url: " example.com ", title: "  Spec  " }),
    );
    expect(spec).toMatchObject({
      moduleId: billing.id,
      url: "https://example.com/",
      title: "Spec",
      createdBy: user.id,
    });
    const docs = await ok<LinkJson>(
      path,
      json("POST", { url: "http://localhost:3000/docs", title: "" }),
    );
    expect(docs).toMatchObject({
      url: "http://localhost:3000/docs",
      title: null,
    });

    // Newest first.
    expect((await ok<LinkJson[]>(path)).map((link) => link.id)).toEqual([
      docs.id,
      spec.id,
    ]);

    // The one link rule shared with task and quick links (utils/link-url.ts).
    for (const url of [
      "javascript:alert(1)",
      "intranet",
      "ftp://example.com",
      "https://exa mple.com",
    ]) {
      const response = await request(path, json("POST", { url }));
      expect(response.status, url).toBe(400);
      expect(await response.text()).toBe("Enter a valid http or https URL");
    }
    const withCredentials = await request(
      path,
      json("POST", { url: "https://user:pass@example.com" }),
    );
    expect(withCredentials.status).toBe(400);
    expect(await withCredentials.text()).toBe(
      "Links can't contain a user name or password",
    );

    const duplicate = await request(
      path,
      json("POST", { url: "https://EXAMPLE.com" }),
    );
    expect(duplicate.status).toBe(409);
    expect(await duplicate.text()).toBe(
      "This link is already added to this module",
    );

    const renamed = await ok<LinkJson>(
      `${path}/${spec.id}`,
      json("PUT", { title: null }),
    );
    expect(renamed).toMatchObject({ url: "https://example.com/", title: null });
    // Keeping its own URL is not a duplicate; taking another link's is.
    await ok(`${path}/${spec.id}`, json("PUT", { url: "example.com" }));
    const taken = await request(
      `${path}/${spec.id}`,
      json("PUT", { url: "http://LOCALHOST:3000/docs" }),
    );
    expect(taken.status).toBe(409);

    expect(await ok(`${path}/${docs.id}`, { method: "DELETE" })).toEqual({
      id: docs.id,
    });
    expect((await ok<LinkJson[]>(path)).map((link) => link.id)).toEqual([
      spec.id,
    ]);
    expect(events.map((event) => event.action)).toEqual([
      "created",
      "created",
      "updated",
      "updated",
      "deleted",
    ]);
  });

  it("caps a module at 100 links", async () => {
    const { request, createModule } = await moduleContext();
    const billing = await createModule({ name: "Billing" });
    await db.insert(schema.moduleLinkTable).values(
      Array.from({ length: 100 }, (_, i) => ({
        moduleId: billing.id,
        url: `https://example.com/${i}`,
      })),
    );
    const response = await request(
      `/${billing.id}/links`,
      json("POST", { url: "https://example.com/extra" }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("A module can have at most 100 links");
  });

  it("scopes links to their module and refuses writes when archived", async () => {
    const ctx = await moduleContext();
    const { ok, request, createModule, insertModule } = ctx;
    const billing = await createModule({ name: "Billing" });
    const onboarding = await createModule({ name: "Onboarding" });
    const link = await ok<LinkJson>(
      `/${billing.id}/links`,
      json("POST", { url: "example.com" }),
    );

    const wrongModule = await request(
      `/${onboarding.id}/links/${link.id}`,
      json("PUT", { title: "x" }),
    );
    expect(wrongModule.status).toBe(404);
    expect(await wrongModule.text()).toBe("Link not found");
    expect(
      (
        await request(`/${onboarding.id}/links/${link.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);

    const archived = await insertModule({
      name: "Done",
      status: "completed",
      archivedAt: new Date(),
    });
    const [archivedLink] = await db
      .insert(schema.moduleLinkTable)
      .values({ moduleId: archived.id, url: "https://example.com/" })
      .returning();
    if (!archivedLink) throw new Error("fixture");
    for (const [path, init] of [
      [`/${archived.id}/links`, json("POST", { url: "example.org" })],
      [`/${archived.id}/links/${archivedLink.id}`, json("PUT", { title: "x" })],
      [`/${archived.id}/links/${archivedLink.id}`, { method: "DELETE" }],
    ] as const) {
      const response = await request(path, init);
      expect(response.status, `${init.method} ${path}`).toBe(409);
    }
    // Reads still work on archived modules.
    expect(await ok<LinkJson[]>(`/${archived.id}/links`)).toHaveLength(1);

    // Another workspace never sees the links.
    const outsider = await moduleContext();
    mockAuthenticatedSession(outsider.user);
    expect((await request(`/${billing.id}/links`)).status).toBe(403);
  });
});
