import { expect, test } from "../../fixtures";
import {
  createProject,
  createWorld,
  eventually,
  expectJson,
  expectStatus,
  type Json,
  type World,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";

// The workspace audit log: recorded actions, permission gating, filters and
// the CSV export.

type Entry = Json & {
  action: string;
  actor: { type: string; userId: string | null };
  target: { type: string; id: string | null; label: string | null } | null;
};
type Page = { items: Entry[]; nextCursor: string | null };

let world: World;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Audit");
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "admins read and export the audit log; members cannot",
  covers("listAuditLog", "exportAuditLog"),
  async () => {
    const workspaceId = world.workspace.id;
    const project = await createProject(world.as("admin"), workspaceId);

    const page = await eventually(
      async () => {
        const result = await expectJson<Page>(
          await world.as("admin").get("/api/audit-log", {
            params: { workspaceId, action: "project" },
          }),
        );
        return result.items.some((entry) => entry.target?.id === project.id)
          ? result
          : undefined;
      },
      { what: "the project.created entry" },
    );
    const created = page.items.find((entry) => entry.target?.id === project.id);
    expect(created?.action).toBe("project.created");
    expect(created?.actor.type).toBe("user");

    await expectStatus(
      await world.as("member").get("/api/audit-log", {
        params: { workspaceId },
      }),
      403,
    );

    const csv = await world.as("owner").get("/api/audit-log/export", {
      params: { workspaceId, action: "project" },
    });
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const text = await csv.text();
    expect(text).toContain('"project.created"');
    await expectStatus(
      await world.as("member").get("/api/audit-log/export", {
        params: { workspaceId },
      }),
      403,
    );
  },
);
