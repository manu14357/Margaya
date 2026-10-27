import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import { json, pageScene } from "./helpers/pages";

// 5.5a: saving a page as a template (for its project or the whole
// workspace) and creating a page from one.

type Template = {
  id: string;
  name: string;
  scope: "project" | "workspace";
  projectId: string | null;
  canDelete: boolean;
};

describe("page templates", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("saves a page as a project template and creates a page from it", async () => {
    const s = await pageScene();
    const source = await s.create(s.ben, {
      title: "Weekly sync",
      logoKind: "emoji",
      logoValue: "📝",
      content: "## Agenda\n\n- [ ] Review last week",
    });

    const viewerSave = await s.call(
      s.viewer,
      `/${source.id}/template`,
      json("POST", { name: "Sync", scope: "project" }),
    );
    expect(viewerSave.status).toBe(403);

    const template = await s.ok<Template>(
      s.ben,
      `/${source.id}/template`,
      json("POST", { name: "Weekly sync", scope: "project" }),
    );
    expect(template).toMatchObject({
      name: "Weekly sync",
      scope: "project",
      projectId: s.project.id,
      canDelete: true,
    });

    const listed = await s.ok<Template[]>(
      s.viewer,
      `/project/${s.project.id}/templates`,
    );
    expect(listed.map((row) => row.id)).toEqual([template.id]);
    expect(listed[0]?.canDelete).toBe(false);

    const page = await s.create(s.cara, { templateId: template.id });
    expect(page.title).toBe("Weekly sync");
    expect(page.logoValue).toBe("📝");
    expect(page.contentMarkdown).toContain("Agenda");
    expect(page.contentMarkdown).toContain("Review last week");
    expect(page.ownerId).toBe(s.cara.id);

    const titled = await s.create(s.cara, {
      templateId: template.id,
      title: "Sync, March 3",
    });
    expect(titled.title).toBe("Sync, March 3");

    const both = await s.call(
      s.cara,
      `/project/${s.project.id}`,
      json("POST", { templateId: template.id, content: "x" }),
    );
    expect(both.status).toBe(400);
  });

  it("offers workspace templates in every project and project templates only in their own", async () => {
    const s = await pageScene();
    const other = await s.project2("api");
    const source = await s.create(s.ben, { title: "Spec", content: "# Spec" });
    const local = await s.ok<Template>(
      s.ben,
      `/${source.id}/template`,
      json("POST", { name: "Local", scope: "project" }),
    );
    const shared = await s.ok<Template>(
      s.ben,
      `/${source.id}/template`,
      json("POST", { name: "Shared", scope: "workspace" }),
    );

    const inOther = await s.ok<Template[]>(
      s.ben,
      `/project/${other.id}/templates`,
    );
    expect(inOther.map((row) => row.id)).toEqual([shared.id]);

    const fromShared = await s.create(
      s.ben,
      { templateId: shared.id },
      other.id,
    );
    expect(fromShared.contentMarkdown).toContain("Spec");
    const fromLocal = await s.call(
      s.ben,
      `/project/${other.id}`,
      json("POST", { templateId: local.id }),
    );
    expect(fromLocal.status).toBe(404);

    // Another workspace's template is unknown.
    const outsider = await createWorkspaceMember({ role: "owner" });
    const foreign = await s.call(outsider.user, `/template/${shared.id}`, {
      method: "DELETE",
    });
    expect(foreign.status).toBe(404);
  });

  it("lets who saved it, or a page manager, delete a template", async () => {
    const s = await pageScene();
    const source = await s.create(s.ben, { title: "Retro" });
    const first = await s.ok<Template>(
      s.ben,
      `/${source.id}/template`,
      json("POST", { name: "Retro", scope: "project" }),
    );
    const second = await s.ok<Template>(
      s.ben,
      `/${source.id}/template`,
      json("POST", { name: "Retro 2", scope: "workspace" }),
    );

    const byCara = await s.call(s.cara, `/template/${first.id}`, {
      method: "DELETE",
    });
    expect(byCara.status).toBe(403);
    expect(
      (await s.call(s.ben, `/template/${first.id}`, { method: "DELETE" }))
        .status,
    ).toBe(200);
    expect(
      (await s.call(s.admin, `/template/${second.id}`, { method: "DELETE" }))
        .status,
    ).toBe(200);
    expect(
      await s.ok<Template[]>(s.ben, `/project/${s.project.id}/templates`),
    ).toEqual([]);
  });
});
