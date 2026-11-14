import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultRolePayloads } from "../../apps/api/node_modules/@margaya/permissions";
import db, { schema } from "../../apps/api/src/database";
import { backfillRolePermissions } from "../../apps/api/src/utils/backfill-role-permissions";
import { addPerson } from "./helpers/assignees";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { json, whiteboardScene } from "./helpers/whiteboards";

// An existing installation upgrading: the migration adds the feature flag
// (on) to every project and creates the tables; the boot backfill gives the
// stored default roles the new whiteboard permission.

const MIGRATION = path.resolve(
  import.meta.dirname,
  "../../apps/api/drizzle/0049_whiteboards.sql",
);

beforeEach(async () => {
  await resetTestDatabase();
});

describe("whiteboards migration on existing data", () => {
  it("adds the tables and turns Whiteboards on for projects that already exist", async () => {
    const statements = readFileSync(MIGRATION, "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    const { workspace } = await createWorkspaceMember({ role: "owner" });

    await db
      .transaction(async (tx) => {
        // Back to the schema before the migration, with a project in it.
        // whiteboard_activity (0050) references whiteboard, so it goes too.
        await tx.execute(sql`DROP TABLE whiteboard_activity`);
        await tx.execute(sql`DROP TABLE whiteboard_task_link`);
        await tx.execute(sql`DROP TABLE whiteboard_asset`);
        await tx.execute(sql`DROP TABLE whiteboard`);
        await tx.execute(
          sql`ALTER TABLE project DROP COLUMN whiteboards_enabled`,
        );
        await tx.execute(sql`
          INSERT INTO project (id, workspace_id, name, slug)
          VALUES ('legacy-project', ${workspace.id}, 'Legacy', 'legacy')
        `);

        for (const statement of statements) {
          await tx.execute(sql.raw(statement));
        }

        const projects = await tx.execute<{ whiteboards_enabled: boolean }>(
          sql`SELECT whiteboards_enabled FROM project WHERE id = 'legacy-project'`,
        );
        expect(projects.rows).toEqual([{ whiteboards_enabled: true }]);
        const tables = await tx.execute<{ table_name: string }>(sql`
          SELECT table_name FROM information_schema.tables
          WHERE table_name IN ('whiteboard', 'whiteboard_asset', 'whiteboard_task_link')
          ORDER BY table_name
        `);
        expect(tables.rows.map((row) => row.table_name)).toEqual([
          "whiteboard",
          "whiteboard_asset",
          "whiteboard_task_link",
        ]);
        // Leave the database as the other tests expect it.
        throw new Error("rollback");
      })
      .catch((error: Error) => {
        if (error.message !== "rollback") throw error;
      });

    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const [row] = await db
      .select({ enabled: schema.projectTable.whiteboardsEnabled })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, project.id));
    expect(row?.enabled).toBe(true);
  });

  it("gives stored default roles the whiteboard permission once", async () => {
    const s = await whiteboardScene();
    // Role rows as an existing workspace stored them, before whiteboards.
    const legacy = Object.fromEntries(
      Object.entries(defaultRolePayloads).map(([role, payload]) => {
        const { whiteboard: _new, ...rest } = payload as Record<
          string,
          string[]
        >;
        return [role, rest];
      }),
    );
    await db.insert(schema.workspaceRoleTable).values(
      Object.entries(legacy).map(([role, permission]) => ({
        workspaceId: s.workspaceId,
        role,
        permission: JSON.stringify(permission),
      })),
    );
    const resources = Object.keys(legacy.member ?? {}).filter(
      (resource) =>
        ![
          "organization",
          "member",
          "invitation",
          "team",
          "ac",
          "project",
          "task",
          "label",
          "workspace",
        ].includes(resource),
    );
    await db
      .insert(schema.rolePermissionBackfillTable)
      .values(
        [...new Set([...resources, "audit_log"])].map((resource) => ({
          resource,
        })),
      )
      .onConflictDoNothing();

    const before = await s.call(
      s.ben,
      "/whiteboard",
      json("POST", { projectId: s.project.id }),
    );
    expect(before.status).toBe(403);

    const result = await backfillRolePermissions();
    expect(result?.pending).toEqual(["whiteboard"]);
    expect(result?.updated).toBe(3);

    const rows = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, s.workspaceId));
    const stored = Object.fromEntries(
      rows.map((row) => [row.role, JSON.parse(row.permission)]),
    );
    expect(stored.viewer.whiteboard).toEqual(["read"]);
    expect(stored.member.whiteboard).toEqual(["create", "read", "update"]);
    expect(stored.admin.whiteboard).toEqual([
      "create",
      "read",
      "update",
      "delete",
    ]);

    const after = await s.call(
      s.ben,
      "/whiteboard",
      json("POST", { projectId: s.project.id }),
    );
    expect(after.status, await after.clone().text()).toBe(201);
    const vic = await addPerson(s.workspaceId, "Late viewer", "viewer");
    expect(
      (await s.call(vic, `/whiteboard?projectId=${s.project.id}`)).status,
    ).toBe(200);
    expect(await backfillRolePermissions()).toBeNull();
  });
});
