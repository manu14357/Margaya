import { and, eq, inArray, like, type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  automationRuleTable,
  customFieldDefinitionTable,
  customFieldValueTable,
  projectTable,
  savedViewTable,
  taskDraftTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import {
  type CustomFieldEdit,
  planCustomFieldEdit,
  renameInDraftValues,
  renameInRuleConditions,
  renameInViewFilters,
} from "../option-edits";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type RenameScope = {
  fieldId: string;
  projectId: string;
  workspaceId: string;
  renames: ReadonlyMap<string, string>;
};

/** Every stored copy of a renamed option moves with it, in one transaction. */
async function applyOptionRenames(tx: Transaction, scope: RenameScope) {
  const { fieldId, projectId, workspaceId, renames } = scope;
  const whens: SQL[] = [...renames].map(
    ([from, to]) => sql`when ${from}::text then ${to}::text`,
  );
  await tx
    .update(customFieldValueTable)
    .set({
      value: sql`case ${customFieldValueTable.value} ${sql.join(whens, sql` `)} else ${customFieldValueTable.value} end`,
    })
    .where(
      and(
        eq(customFieldValueTable.fieldId, fieldId),
        inArray(customFieldValueTable.value, [...renames.keys()]),
      ),
    );

  // Field ids are generated, so they are safe inside a LIKE pattern; the text
  // match only narrows the rows the JSON walk below then reads exactly.
  const mentionsField = `%${fieldId}%`;

  const views = await tx
    .select({ id: savedViewTable.id, filters: savedViewTable.filters })
    .from(savedViewTable)
    .where(
      and(
        eq(savedViewTable.workspaceId, workspaceId),
        like(sql`${savedViewTable.filters}::text`, mentionsField),
      ),
    );
  for (const view of views) {
    const filters = renameInViewFilters(view.filters, fieldId, renames);
    if (filters) {
      await tx
        .update(savedViewTable)
        .set({ filters: filters as typeof view.filters })
        .where(eq(savedViewTable.id, view.id));
    }
  }

  const rules = await tx
    .select({
      id: automationRuleTable.id,
      conditions: automationRuleTable.conditions,
    })
    .from(automationRuleTable)
    .where(
      and(
        eq(automationRuleTable.projectId, projectId),
        like(sql`${automationRuleTable.conditions}::text`, mentionsField),
      ),
    );
  for (const rule of rules) {
    const conditions = renameInRuleConditions(
      rule.conditions,
      fieldId,
      renames,
    );
    if (conditions) {
      await tx
        .update(automationRuleTable)
        .set({ conditions })
        .where(eq(automationRuleTable.id, rule.id));
    }
  }

  const drafts = await tx
    .select({
      id: taskDraftTable.id,
      customFieldValues: taskDraftTable.customFieldValues,
    })
    .from(taskDraftTable)
    .where(
      and(
        eq(taskDraftTable.projectId, projectId),
        like(sql`${taskDraftTable.customFieldValues}::text`, mentionsField),
      ),
    );
  for (const draft of drafts) {
    const customFieldValues = renameInDraftValues(
      draft.customFieldValues,
      fieldId,
      renames,
    );
    if (customFieldValues) {
      await tx
        .update(taskDraftTable)
        .set({ customFieldValues })
        .where(eq(taskDraftTable.id, draft.id));
    }
  }
}

async function updateCustomField(id: string, edit: CustomFieldEdit) {
  const updated = await db.transaction(async (tx) => {
    // The row lock serializes two people editing one field's options.
    const [found] = await tx
      .select({
        field: customFieldDefinitionTable,
        workspaceId: projectTable.workspaceId,
      })
      .from(customFieldDefinitionTable)
      .innerJoin(
        projectTable,
        eq(projectTable.id, customFieldDefinitionTable.projectId),
      )
      .where(eq(customFieldDefinitionTable.id, id))
      .for("update", { of: customFieldDefinitionTable });

    if (!found) {
      throw new HTTPException(404, { message: "Custom field not found" });
    }

    const { changes, renames } = planCustomFieldEdit(found.field, edit);
    if (Object.keys(changes).length === 0) return found.field;

    const [saved] = await tx
      .update(customFieldDefinitionTable)
      .set(changes)
      .where(eq(customFieldDefinitionTable.id, id))
      .returning();
    if (!saved) {
      throw new HTTPException(404, { message: "Custom field not found" });
    }

    if (renames.size > 0) {
      await applyOptionRenames(tx, {
        fieldId: id,
        projectId: saved.projectId,
        workspaceId: found.workspaceId,
        renames,
      });
    }
    return saved;
  });

  await publishEvent("custom_field.updated", {
    fieldId: updated.id,
    projectId: updated.projectId,
  });
  return updated;
}

export default updateCustomField;
