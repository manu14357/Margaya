import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

async function scene() {
  const first = await createWorkspaceMember({ userName: "Ann" });
  const second = await createWorkspaceMember({ userName: "Bo" });
  const { app } = createApp();
  const as =
    (user: typeof first.user) => (path: string, init?: RequestInit) => {
      mockAuthenticatedSession(user);
      return app.request(`/api${path}`, init);
    };
  return { ann: as(first.user), bo: as(second.user), annId: first.user.id };
}

describe("API integration: user preferences", () => {
  it("starts empty, merges patches and stays per user", async () => {
    const s = await scene();
    expect(await (await s.ann("/user/preferences")).json()).toEqual({
      preferences: null,
    });

    const first = await s.ann(
      "/user/preferences",
      json("PATCH", { theme: "dark-contrast", weekStartsOn: 1 }),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      preferences: { theme: "dark-contrast", weekStartsOn: 1 },
    });

    const second = await s.ann(
      "/user/preferences",
      json("PATCH", { pagesFormatToolbar: false }),
    );
    expect(await second.json()).toEqual({
      preferences: {
        theme: "dark-contrast",
        weekStartsOn: 1,
        pagesFormatToolbar: false,
      },
    });

    expect(await (await s.bo("/user/preferences")).json()).toEqual({
      preferences: null,
    });
  });

  it("rejects unknown keys and invalid values", async () => {
    const s = await scene();
    for (const body of [
      { theme: "neon" },
      { weekStartsOn: 3 },
      { somethingElse: true },
      { showLabels: "yes" },
    ]) {
      const response = await s.ann("/user/preferences", json("PATCH", body));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("drops stored values a reader does not understand", async () => {
    const s = await scene();
    await db
      .update(schema.userTable)
      .set({ preferences: { theme: "neon", showLabels: false, extra: 1 } })
      .where(eq(schema.userTable.id, s.annId));
    expect(await (await s.ann("/user/preferences")).json()).toEqual({
      preferences: { showLabels: false },
    });
  });

  it("keeps a sidebar layout, resets it with null and rejects unknown items", async () => {
    const s = await scene();
    const layout = {
      railOrder: ["projects", "home", "inbox"],
      railHidden: ["pages"],
      panelOrder: ["projects", "favorites", "views"],
      panelHidden: ["views"],
    };
    const saved = await s.ann(
      "/user/preferences",
      json("PATCH", { sidebarLayout: layout }),
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      preferences: { sidebarLayout: layout },
    });
    expect(await (await s.bo("/user/preferences")).json()).toEqual({
      preferences: null,
    });

    for (const sidebarLayout of [
      { ...layout, railOrder: ["settings"] },
      { ...layout, panelHidden: ["pages"] },
      { ...layout, extra: true },
      { railOrder: [] },
    ]) {
      const response = await s.ann(
        "/user/preferences",
        json("PATCH", { sidebarLayout }),
      );
      expect(response.status, JSON.stringify(sidebarLayout)).toBe(400);
    }

    const reset = await s.ann(
      "/user/preferences",
      json("PATCH", { sidebarLayout: null }),
    );
    expect(await reset.json()).toEqual({
      preferences: { sidebarLayout: null },
    });
  });
});
