import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import * as schema from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { TEMPLATE_DEFINITIONS } from "../../apps/api/src/project-template/definitions";
import { mockAuthenticatedSession } from "./helpers/auth";
import { json } from "./helpers/cycles";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

// Every built-in template must create a real project, with and without
// example tasks, in English and in a second language. The checker proves the
// definitions are valid; this proves the database accepts what they write.
describe("every built-in template", () => {
  let request: (body: Record<string, unknown>) => Promise<Response>;
  let workspaceId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    const owner = await createWorkspaceMember({ role: "owner" });
    workspaceId = owner.workspace.id;
    const { app } = createApp();
    request = (body) => {
      mockAuthenticatedSession(owner.user as never);
      return app.request(
        "/api/project",
        json("POST", { workspaceId, icon: "FolderKanban", ...body }),
      );
    };
  });

  it("applies every workspace starter to a fresh workspace", async () => {
    const { availableStarters } = await import(
      "../../apps/api/src/project-template/starters"
    );
    const starters = availableStarters();
    expect(starters.length).toBe(12);
    const { app } = createApp();
    for (const starter of starters) {
      const fresh = await createWorkspaceMember({ role: "owner" });
      mockAuthenticatedSession(fresh.user as never);
      const response = await app.request(
        `/api/workspace/${fresh.workspace.id}/starter`,
        json("POST", { starterId: starter.id, sampleData: true }),
      );
      const text = await response.text();
      expect(response.status, `${starter.id}: ${text}`).toBe(200);
      const projects = await db
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(eq(schema.projectTable.workspaceId, fresh.workspace.id));
      expect(projects.length, starter.id).toBe(starter.projects.length);
    }
  });

  it("covers the whole catalog", () => {
    expect(TEMPLATE_DEFINITIONS.length).toBeGreaterThanOrEqual(52);
  });

  for (const [index, template] of TEMPLATE_DEFINITIONS.entries()) {
    for (const [variant, sampleData, locale] of [
      ["en", true, "en-US"],
      ["de", false, "de-DE"],
    ] as const) {
      it(`${template.id} (${variant}, example tasks ${sampleData ? "on" : "off"})`, async () => {
        const slug = `T${index}${variant.toUpperCase()}`;
        const response = await request({
          name: `${template.id} ${variant}`,
          slug,
          template: { id: template.id, sampleData, locale },
        });
        const body = (await response.json()) as {
          id: string;
          template?: {
            id: string;
            sampleTaskCount: number;
            skipped: unknown[];
          };
        };
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.template?.id).toBe(template.id);
        expect(body.template?.skipped).toEqual([]);
        const columns = await db
          .select({ id: schema.columnTable.id })
          .from(schema.columnTable)
          .where(eq(schema.columnTable.projectId, body.id));
        expect(columns.length).toBe(template.columns.length);
        // The count includes sub-tasks, so it is at least the top-level tasks.
        const topLevel = sampleData ? (template.sample?.tasks.length ?? 0) : 0;
        if (sampleData) {
          expect(body.template?.sampleTaskCount).toBeGreaterThanOrEqual(
            topLevel,
          );
        } else {
          expect(body.template?.sampleTaskCount).toBe(0);
        }
      });
    }
  }
});
