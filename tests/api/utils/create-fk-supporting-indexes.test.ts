import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Margaya ships a single baseline migration, so the foreign-key supporting
// indexes and the NOT NULL `updated_at` columns must be created there.
const migrationPath = resolve(
  process.cwd(),
  "drizzle/0000_margaya_baseline.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");

function tableDefinition(table: string) {
  const start = migrationSql.indexOf(`CREATE TABLE "${table}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  return migrationSql.slice(start, migrationSql.indexOf(");", start));
}

describe("baseline migration foreign-key support", () => {
  it("creates updated_at columns as NOT NULL with a default", () => {
    expect(tableDefinition("notification")).toContain(
      '"updated_at" timestamp with time zone DEFAULT now() NOT NULL',
    );
    expect(tableDefinition("time_entry")).toContain(
      '"updated_at" timestamp DEFAULT now() NOT NULL',
    );
  });

  it("creates the expected FK-supporting indexes", () => {
    const indexNames = [
      "activity_userId_idx",
      "asset_createdBy_idx",
      "invitation_inviterId_idx",
      "notification_userId_idx",
      "task_assigneeId_idx",
      "task_columnId_idx",
      "time_entry_taskId_idx",
      "time_entry_userId_idx",
      "user_notification_workspace_project_workspaceId_projectId_idx",
      "unwp_workspaceId_workspaceRuleId_idx",
      "workflow_rule_columnId_idx",
    ];

    for (const indexName of indexNames) {
      expect(migrationSql).toContain(`CREATE INDEX "${indexName}"`);
    }

    expect(migrationSql).not.toContain("CONCURRENTLY");
  });
});

describe("multi-assignee migration", () => {
  const assigneeSql = readFileSync(
    resolve(process.cwd(), "drizzle/0002_multi_assignee.sql"),
    "utf8",
  );

  it("adds the join table with its FK-supporting indexes, and nothing else", () => {
    expect(assigneeSql).toContain('CREATE TABLE "task_assignee"');
    expect(assigneeSql).toContain(
      'CONSTRAINT "task_assignee_task_user_unique" UNIQUE("task_id","user_id")',
    );
    expect(assigneeSql).toContain('CREATE INDEX "task_assignee_userId_idx"');
    expect(assigneeSql).toContain(
      'CREATE INDEX "task_assignee_taskId_position_idx"',
    );
    expect(assigneeSql).not.toMatch(/DROP|ALTER TABLE "task" /);
  });
});

describe("task detail migration", () => {
  const taskDetailSql = readFileSync(
    resolve(process.cwd(), "drizzle/0003_task_detail.sql"),
    "utf8",
  );

  it("adds the task link table with its FK-supporting indexes", () => {
    expect(taskDetailSql).toContain('CREATE TABLE "task_link"');
    expect(taskDetailSql).toContain(
      'CONSTRAINT "task_link_task_url_unique" UNIQUE("task_id","url")',
    );
    expect(taskDetailSql).toContain('CREATE INDEX "task_link_createdBy_idx"');
  });

  it("only swaps the relation indexes for (task, type) ones and touches no data", () => {
    expect(taskDetailSql).toContain(
      'CREATE INDEX "task_relation_source_type_idx" ON "task_relation" USING btree ("source_task_id","relation_type")',
    );
    expect(taskDetailSql).toContain(
      'CREATE INDEX "task_relation_target_type_idx" ON "task_relation" USING btree ("target_task_id","relation_type")',
    );
    const drops = taskDetailSql.match(/DROP [A-Z]+ "[^"]+"/g) ?? [];
    expect(drops).toEqual([
      'DROP INDEX "task_relation_source_idx"',
      'DROP INDEX "task_relation_target_idx"',
    ]);
    expect(taskDetailSql).not.toMatch(
      /DELETE FROM|UPDATE "|INSERT INTO|ALTER TABLE "(task|task_relation|asset|activity)" /,
    );
  });
});

describe("inbox migration", () => {
  const inboxSql = readFileSync(
    resolve(process.cwd(), "drizzle/0005_inbox.sql"),
    "utf8",
  );

  it("creates the FK-supporting indexes of the new tables and columns", () => {
    for (const indexName of [
      "task_subscriber_userId_idx",
      "task_mention_taskId_idx",
      "task_mention_userId_idx",
      "task_mention_commentId_idx",
      "reaction_taskId_createdAt_idx",
      "reaction_commentId_idx",
      "reaction_userId_idx",
      "notification_workspaceId_idx",
      "notification_actorId_idx",
    ]) {
      expect(inboxSql).toContain(`CREATE INDEX "${indexName}"`);
    }
    expect(inboxSql).toContain(
      'CONSTRAINT "task_subscriber_task_user_unique" UNIQUE("task_id","user_id")',
    );
  });

  it("cascades a workspace delete and nulls a deleted actor", () => {
    expect(inboxSql).toContain(
      'FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade',
    );
    expect(inboxSql).toContain(
      'FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null',
    );
  });

  it("is purely additive", () => {
    expect(inboxSql).not.toMatch(/DROP |DELETE FROM|UPDATE "|INSERT INTO/);
    expect(inboxSql).not.toContain("CONCURRENTLY");
  });
});
