import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { json, pageScene, setPagesEnabled } from "./helpers/pages";

const OFF = "The Pages feature is turned off for this project.";

describe("API integration: Pages feature gate", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("answers 403 on every page route while Pages is off, and recovers", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, { title: "Kept", content: "Body" });
    await s.ok(
      s.ben,
      `/${page.id}/content`,
      json("PUT", { markdown: "Body 2" }),
    );
    const [version] = await db.select().from(schema.pageVersionTable);
    const target = await s.project2();
    await setPagesEnabled(s.project.id, false);

    const routes: Array<[string, RequestInit | undefined]> = [
      [`/project/${s.project.id}`, undefined],
      [`/project/${s.project.id}`, json("POST", {})],
      [`/${page.id}`, undefined],
      [`/${page.id}`, json("PATCH", { title: "x" })],
      [`/${page.id}/content`, json("PUT", { markdown: "x" })],
      [`/${page.id}/position`, json("PUT", { parentId: null })],
      [`/${page.id}/lock`, { method: "POST" }],
      [`/${page.id}/lock`, { method: "DELETE" }],
      [`/${page.id}/access`, json("PUT", { access: "private" })],
      [`/${page.id}/archive`, { method: "POST" }],
      [`/${page.id}/unarchive`, { method: "POST" }],
      [`/${page.id}`, { method: "DELETE" }],
      [`/${page.id}/duplicate`, { method: "POST" }],
      [`/${page.id}/move`, json("POST", { projectId: target.id })],
      [`/${page.id}/versions`, undefined],
      [`/${page.id}/versions/${version?.id}`, undefined],
      [`/${page.id}/versions/${version?.id}/restore`, { method: "POST" }],
      [`/${page.id}/backlinks`, undefined],
      [
        `/${page.id}/asset-upload`,
        json("PUT", { filename: "a.png", contentType: "image/png", size: 1 }),
      ],
      [
        `/${page.id}/asset-upload/finalize`,
        json("POST", {
          key: "k",
          filename: "a.png",
          contentType: "image/png",
          size: 1,
        }),
      ],
    ];
    for (const [path, init] of routes) {
      const response = await s.call(s.ben, path, init);
      expect(response.status, `${init?.method ?? "GET"} ${path}`).toBe(403);
      expect(await response.text()).toBe(OFF);
    }

    await setPagesEnabled(s.project.id, true);
    const back = await s.get(s.ben, page.id);
    expect(back.title).toBe("Kept");
    expect(back.contentMarkdown).toBe("Body 2");
  });
});
