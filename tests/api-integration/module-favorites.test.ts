import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "./helpers/database";
import { json, moduleContext } from "./helpers/modules";

type Favorite = {
  entityType: string;
  entityId: string;
  entity: {
    name: string;
    icon: string | null;
    projectId: string | null;
    isArchived: boolean;
    feature: string | null;
    details: Record<string, unknown> | null;
  };
};

describe("API integration: module favorites and recent visits", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("resolves modules and hides them while the feature is off", async () => {
    const { app, ok, createModule, workspace, project } =
      await moduleContext("admin");
    const billing = await createModule({
      name: "Billing",
      status: "in-progress",
    });
    const favorites = async () => {
      const response = await app.request(
        `/api/favorite?workspaceId=${workspace.id}`,
      );
      expect(response.status).toBe(200);
      return (await response.json()) as Favorite[];
    };

    const added = await app.request(
      "/api/favorite",
      json("POST", {
        workspaceId: workspace.id,
        entityType: "module",
        entityId: billing.id,
      }),
    );
    expect(added.status, await added.clone().text()).toBe(200);
    expect(await favorites()).toMatchObject([
      {
        entityType: "module",
        entityId: billing.id,
        entity: {
          name: "Billing",
          icon: "Boxes",
          projectId: project.id,
          isArchived: false,
          feature: "modules",
          details: { status: "in-progress" },
        },
      },
    ]);

    await ok(`/${billing.id}`, json("PUT", { name: "Billing v2" }));
    expect((await favorites())[0]?.entity.name).toBe("Billing v2");

    const setFeature = (modulesEnabled: boolean) =>
      app.request(
        `/api/project/${project.id}/features`,
        json("PATCH", { modulesEnabled }),
      );
    expect((await setFeature(false)).status).toBe(200);
    expect(await favorites()).toEqual([]);
    expect((await setFeature(true)).status).toBe(200);
    expect(await favorites()).toHaveLength(1);

    const visit = await app.request(
      "/api/recent-visit",
      json("POST", {
        workspaceId: workspace.id,
        entityType: "module",
        entityId: billing.id,
      }),
    );
    expect(visit.status, await visit.clone().text()).toBe(200);

    await ok(`/${billing.id}`, { method: "DELETE" });
    expect(await favorites()).toEqual([]);
    const recents = await app.request(
      `/api/recent-visit?workspaceId=${workspace.id}`,
    );
    expect(await recents.json()).toEqual([]);
  });
});
