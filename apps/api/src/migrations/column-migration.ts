import { and, eq, sql } from "drizzle-orm";
import db from "../database";
import {
  columnTable,
  integrationTable,
  projectTable,
  taskTable,
  workflowRuleTable,
} from "../database/schema";

const DEFAULT_COLUMNS = [
  {
    name: "To Do",
    slug: "to-do",
    position: 0,
    group: "unstarted",
    isFinal: false,
  },
  {
    name: "In Progress",
    slug: "in-progress",
    position: 1,
    group: "started",
    isFinal: false,
  },
  {
    name: "In Review",
    slug: "in-review",
    position: 2,
    group: "started",
    isFinal: false,
  },
  {
    name: "Done",
    slug: "done",
    position: 3,
    group: "completed",
    isFinal: true,
  },
] as const;

const EVENT_MAPPING: Record<string, string> = {
  onBranchPush: "branch_push",
  onPROpen: "pr_opened",
  onPRMerge: "pr_merged",
};

export async function migrateColumns() {
  console.log("🔄 Starting column migration...");

  const projects = await db.select().from(projectTable);

  if (projects.length === 0) {
    console.log("No projects found, skipping column migration");
    return;
  }

  for (const project of projects) {
    const projectColumns = await db
      .select({
        id: columnTable.id,
        slug: columnTable.slug,
      })
      .from(columnTable)
      .where(eq(columnTable.projectId, project.id));

    const columnMap = new Map<string, string>(
      projectColumns.map((column) => [column.slug, column.id]),
    );

    // Only seed missing default slugs for legacy projects that have no columns yet.
    // If the project already has columns, missing slugs are intentional (user removed them);
    // re-inserting on every startup would undo deletions after each API restart.
    if (projectColumns.length === 0) {
      for (const defaultColumn of DEFAULT_COLUMNS) {
        if (columnMap.has(defaultColumn.slug)) {
          continue;
        }

        const [inserted] = await db
          .insert(columnTable)
          .values({
            projectId: project.id,
            name: defaultColumn.name,
            slug: defaultColumn.slug,
            position: defaultColumn.position,
            group: defaultColumn.group,
            isFinal: defaultColumn.isFinal,
          })
          .returning({ id: columnTable.id, slug: columnTable.slug });

        if (inserted) {
          columnMap.set(inserted.slug, inserted.id);
        }
      }
    }

    for (const [slug, columnId] of columnMap) {
      await db
        .update(taskTable)
        .set({ columnId })
        .where(
          sql`${taskTable.projectId} = ${project.id}
              AND ${taskTable.status} = ${slug}
              AND ${taskTable.columnId} IS DISTINCT FROM ${columnId}`,
        );
    }

    const integrations = await db.query.integrationTable.findMany({
      where: eq(integrationTable.projectId, project.id),
    });

    for (const integration of integrations) {
      if (
        (integration.type !== "github" && integration.type !== "gitea") ||
        !integration.isActive
      ) {
        continue;
      }

      const forgeType = integration.type as "github" | "gitea";

      try {
        const config = JSON.parse(integration.config);
        const transitions = config.statusTransitions || {};

        for (const [configKey, eventType] of Object.entries(EVENT_MAPPING)) {
          const targetSlug = transitions[configKey];
          if (!targetSlug) continue;

          const targetColumnId = columnMap.get(targetSlug);
          if (!targetColumnId) continue;

          await ensureMigrationWorkflowRule(
            project.id,
            forgeType,
            eventType as string,
            targetColumnId,
          );
        }

        // Add default rules for issue events
        const todoColumnId = columnMap.get("to-do");
        const doneColumnId = columnMap.get("done");

        if (todoColumnId) {
          await ensureMigrationWorkflowRule(
            project.id,
            forgeType,
            "issue_opened",
            todoColumnId,
          );
        }

        if (doneColumnId) {
          await ensureMigrationWorkflowRule(
            project.id,
            forgeType,
            "issue_closed",
            doneColumnId,
          );
        }
      } catch {
        console.error(
          `Failed to migrate workflow rules for integration ${integration.id}`,
        );
      }
    }
  }

  await repairColumnGroups();

  console.log(
    `✅ Column migration complete! Migrated ${projects.length} projects`,
  );
}

/**
 * Idempotent safety net run on every boot, after columns exist. Each step is a
 * single UPDATE whose WHERE matches only inconsistent rows, so a clean
 * database does no writes. Raw SQL keeps task.updated_at untouched.
 */
export async function repairColumnGroups() {
  // 1. A final column in an open group is a completed column.
  await db.execute(sql`
    UPDATE ${columnTable}
    SET status_group = 'completed'
    WHERE is_final = true
      AND status_group IN ('backlog', 'unstarted', 'started')
  `);

  // 2. isFinal mirrors "closed" (completed or cancelled).
  await db.execute(sql`
    UPDATE ${columnTable}
    SET is_final = (status_group IN ('completed', 'cancelled'))
    WHERE is_final IS DISTINCT FROM (status_group IN ('completed', 'cancelled'))
  `);

  // 3. Tasks in a completed column without a completion time take their last
  //    update as the best available estimate.
  await db.execute(sql`
    UPDATE ${taskTable} AS t
    SET completed_at = t.updated_at
    FROM ${columnTable} AS c
    WHERE c.project_id = t.project_id
      AND c.slug = t.status
      AND c.status_group = 'completed'
      AND t.completed_at IS NULL
  `);

  // 4. Non-archived tasks outside completed columns are not completed.
  await db.execute(sql`
    UPDATE ${taskTable} AS t
    SET completed_at = NULL
    WHERE t.completed_at IS NOT NULL
      AND t.status <> 'archived'
      AND NOT EXISTS (
        SELECT 1 FROM ${columnTable} AS c
        WHERE c.project_id = t.project_id
          AND c.slug = t.status
          AND c.status_group = 'completed'
      )
  `);
}

async function ensureMigrationWorkflowRule(
  projectId: string,
  integrationType: "github" | "gitea",
  eventType: string,
  columnId: string,
) {
  const existing = await db.query.workflowRuleTable.findFirst({
    where: and(
      eq(workflowRuleTable.projectId, projectId),
      eq(workflowRuleTable.integrationType, integrationType),
      eq(workflowRuleTable.eventType, eventType),
    ),
  });

  if (existing) {
    return;
  }

  await db.insert(workflowRuleTable).values({
    projectId,
    integrationType,
    eventType,
    columnId,
  });
}
