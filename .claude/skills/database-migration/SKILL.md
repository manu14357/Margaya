---
name: database-migration
description: Workflow for changing the PostgreSQL schema in apps/api with Drizzle - schema.ts, relations.ts, db:generate, reviewing the SQL, backfills for existing installs, indexes, cascades and the migrations journal. Use when adding or changing a table, column, index, foreign key, enum-like text field or default, or when a feature needs a data backfill.
---

# Database migration

A schema change has to work on an existing installation with real data, not only on an empty dev database ([AGENTS.md](../../../AGENTS.md), "Boundaries that must hold"). Drizzle generates the SQL. You review it, and you decide how existing rows get valid values.

## How migrations run

- `apps/api/drizzle.config.ts` points Drizzle Kit at `src/database/schema.ts` and writes to `apps/api/drizzle/`.
- Migrations are numbered `NNNN_name.sql`. Each has a snapshot in `apps/api/drizzle/meta/NNNN_snapshot.json` and an entry in `apps/api/drizzle/meta/_journal.json`.
- The API migrates on boot: `startServer()` in `apps/api/src/index.ts` calls `migrate(getDatabase(), { migrationsFolder })`. Then it runs the idempotent boot steps (`migrateColumns()`, `migrateTaskArchive()`, `seedDefaultWorkspaceRoles()`, `backfillRolePermissions()` and others).
- Drizzle applies a migration only when its journal `when` is newer than the last applied row in `__drizzle_migrations`. All pending migrations run in **one transaction**. So:
  - **Never edit or renumber an existing migration**, and never change a `when`. Installed databases never re-run them, and the change would silently not ship.
  - No `CREATE INDEX CONCURRENTLY` (it cannot run in a transaction). `tests/api/utils/create-fk-supporting-indexes.test.ts` checks this for the baseline.

## 1. Change the schema

- Tables live in `apps/api/src/database/schema.ts`. Copy a recent table such as `automationRuleTable`:
  - `id: text("id").$defaultFn(() => createId()).primaryKey()`
  - timestamps `timestamp("created_at", { mode: "date", withTimezone: true }).defaultNow().notNull()`, and `updatedAt` with `.$onUpdate(() => new Date())`
  - foreign keys with explicit `onDelete` / `onUpdate`
  - indexes in the third argument: `index("automation_rule_project_trigger_idx").on(...)`
- **Cascades**: pick `onDelete` on purpose. Project-owned rows use `"cascade"` (deleting the project removes them). Authorship columns like `createdBy` use `"set null"` so removing a user keeps the history. Check workspace and account deletion paths (`apps/api/src/workspace-deletion/`) when a new table hangs off a user or workspace.
- **Indexes**: index every foreign key you filter or join on, plus the columns of hot board or list queries. Name them `<table>_<columns>_idx`.
- **Relations** go in `apps/api/src/database/relations.ts` (e.g. `automationRuleTableRelations`).
- **Relational queries**: `db.query.<table>` only works for tables that are also listed in the `schema` object in `apps/api/src/database/index.ts`. Add the table and its relations there if you need `db.query`. Otherwise use `db.select()`, as the automation-rule code does.

## 2. Make it safe for existing rows

Choose one approach per column:

| Change | Approach |
| --- | --- |
| New nullable column | Nothing extra. |
| New `NOT NULL` column with a constant default | `.notNull().default(...)`. Postgres fills existing rows. Example: `ALTER TABLE "workspace" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL` in `0016_timezone_project_lead.sql`. |
| Values derived from other rows, fits in SQL | Add the column nullable, generate, then append an `UPDATE` to the generated file before committing. Or generate an empty migration with `--custom` (below). Only edit a migration that has never been committed. |
| Large or logic-heavy backfill | An idempotent boot step in `apps/api/src/migrations/`, called from `startServer()`. Copy `apps/api/src/migrations/task-archive-migration.ts`: each statement's `WHERE` matches only rows that still need it, so every boot is safe. |
| New permission resource for existing roles | Handled by `backfillRolePermissions()`. See the [permissions](../permissions/SKILL.md) skill. |

Do not add a unique constraint or `NOT NULL` without a default until you have proved that existing data satisfies it.

## 3. Generate the migration

From the repo root:

```sh
pnpm --filter @margaya/api db:generate --name short_feature_name
pnpm --filter @margaya/api db:generate --name backfill_x --custom   # empty file for hand-written SQL
```

`--name` keeps the descriptive file names the repo uses (`0036_automation_rules.sql`). This writes the `.sql` file and a new snapshot, and appends to `_journal.json`. Commit all three together.

## 4. Inspect the SQL

Open the new `apps/api/drizzle/NNNN_*.sql` and check:
- Only your intended changes are present. If unrelated tables show up, the schema and snapshots have drifted. Stop and find out why before going on.
- No `DROP COLUMN` or `DROP TABLE` you did not intend. A rename can show up as drop plus add; rewrite it as `ALTER TABLE ... RENAME COLUMN` if needed.
- Foreign keys have the `ON DELETE` you chose, and each has a supporting index.
- `NOT NULL` additions have a default or a backfill in the same file.
- Statements are separated by `--> statement-breakpoint`.

## 5. Follow the change through

- Response schemas and OpenAPI: if the column is returned, see the [api-endpoint](../api-endpoint/SKILL.md) skill. Never expose internal or secret columns.
- Search, exports, trash/restore, workspace deletion and the audit log may read the table. Grep for the table name before you finish.
- Helm and Docker need nothing for an ordinary migration, because the API migrates itself on boot.

## 6. Tests

- Integration tests migrate a real database. `ensureTestDatabaseMigrated()` in `tests/api-integration/helpers/database.ts` runs the same `migrate()` against `apps/api/drizzle`. `resetTestDatabase()` truncates every public table between tests. A broken migration fails the whole suite.
- `tests/api-integration/setup.ts` turns `DATABASE_URL` into a `*_test` database and refuses anything else. Never point it at a real database.
- Write a test for the backfill: insert rows shaped as before, run the boot step, and assert the result. `tests/api-integration/role-permission-backfill.test.ts` shows the pattern (seed `LEGACY` rows, then call the backfill).

## Done when

- [ ] The new `.sql`, snapshot and `_journal.json` entry exist; no earlier migration file changed (`git diff --stat apps/api/drizzle`)
- [ ] The SQL was read and contains only the intended statements
- [ ] Existing rows get valid values (default, SQL backfill or boot step), covered by a test
- [ ] `pnpm --filter @margaya/api typecheck` passes
- [ ] `pnpm --filter @margaya/api test:integration` passes against a `_test` PostgreSQL database
