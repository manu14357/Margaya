import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  customFieldDefinitionTable,
  intakeFormTable,
  projectTable,
} from "../database/schema";
import { submitIntakeItem } from "../intake/service";
import { publicBoardInstanceState } from "../public-board/instance-state";
import {
  sanitizeRequestDescription,
  sanitizeRequestTitle,
} from "../public-board/sanitize";
import { generateLinkToken, isLinkTokenFormat } from "../publication/token";
import { validateCustomFieldValue } from "../task/validate-task-fields";

// The public request form (#8): settings for project admins, and the
// public read and submit. The public side shows only what the admin chose
// for the form: never the project, workspace, members or tasks.

export const FIELD_MODES = ["off", "optional", "required"] as const;
export type FieldMode = (typeof FIELD_MODES)[number];

export const FORM_NOT_FOUND = "This form doesn't exist or is closed";
export const MAX_FORM_TITLE = 200;
export const MAX_FORM_INTRO = 2_000;
export const MAX_FORM_CONFIRMATION = 1_000;
export const MAX_FORM_CUSTOM_FIELDS = 20;
export const MAX_CUSTOM_TEXT = 1_000;
export const MAX_NAME = 200;
// Bots fill a form in well under this; people don't.
export const MIN_FILL_MS = 2_000;

type Row = typeof intakeFormTable.$inferSelect;

export function publicFormPath(token: string) {
  return `/request-form/${token}`;
}

async function loadRow(projectId: string): Promise<Row | null> {
  const [row] = await db
    .select()
    .from(intakeFormTable)
    .where(eq(intakeFormTable.projectId, projectId))
    .limit(1);
  return row ?? null;
}

export async function toFormSettings(projectId: string, row: Row | null) {
  const instance = await publicBoardInstanceState();
  return {
    projectId,
    enabled: row?.enabled ?? false,
    path: row ? publicFormPath(row.token) : null,
    title: row?.title ?? null,
    intro: row?.intro ?? null,
    descriptionField: row?.descriptionField ?? "optional",
    emailField: row?.emailField ?? "required",
    nameField: row?.nameField ?? "optional",
    customFieldIds: row?.customFieldIds ?? [],
    confirmationMessage: row?.confirmationMessage ?? null,
    publicSharingAllowed: instance.publicBoards,
  };
}

export async function getFormSettings(projectId: string) {
  return toFormSettings(projectId, await loadRow(projectId));
}

export type FormSettingsInput = {
  enabled?: boolean;
  title?: string | null;
  intro?: string | null;
  descriptionField?: FieldMode;
  emailField?: FieldMode;
  nameField?: FieldMode;
  customFieldIds?: string[];
  confirmationMessage?: string | null;
};

function cleanText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

async function assertProjectFields(projectId: string, ids: string[]) {
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: customFieldDefinitionTable.id })
    .from(customFieldDefinitionTable)
    .where(
      and(
        eq(customFieldDefinitionTable.projectId, projectId),
        inArray(customFieldDefinitionTable.id, ids),
      ),
    );
  if (rows.length !== ids.length) {
    throw new HTTPException(400, {
      message: "A custom field doesn't belong to this project",
    });
  }
}

export async function updateFormSettings(
  projectId: string,
  input: FormSettingsInput,
) {
  const instance = await publicBoardInstanceState();
  if (input.enabled && !instance.publicBoards) {
    throw new HTTPException(409, {
      message: "Public sharing is turned off on this server",
    });
  }
  const values: Partial<typeof intakeFormTable.$inferInsert> = {};
  if (input.enabled !== undefined) values.enabled = input.enabled;
  const title = cleanText(input.title);
  if (title !== undefined) values.title = title;
  const intro = cleanText(input.intro);
  if (intro !== undefined) values.intro = intro;
  const confirmation = cleanText(input.confirmationMessage);
  if (confirmation !== undefined) values.confirmationMessage = confirmation;
  if (input.descriptionField) values.descriptionField = input.descriptionField;
  if (input.emailField) values.emailField = input.emailField;
  if (input.nameField) values.nameField = input.nameField;
  if (input.customFieldIds) {
    const ids = [...new Set(input.customFieldIds)];
    await assertProjectFields(projectId, ids);
    values.customFieldIds = ids;
  }

  const existing = await loadRow(projectId);
  if (existing) {
    if (Object.keys(values).length > 0) {
      await db
        .update(intakeFormTable)
        .set(values)
        .where(eq(intakeFormTable.projectId, projectId));
    }
  } else {
    await db
      .insert(intakeFormTable)
      .values({ projectId, token: generateLinkToken(), ...values })
      .onConflictDoNothing({ target: intakeFormTable.projectId });
  }
  return getFormSettings(projectId);
}

export async function rotateFormLink(projectId: string) {
  if (!(await loadRow(projectId))) {
    throw new HTTPException(404, { message: "The form isn't set up" });
  }
  await db
    .update(intakeFormTable)
    .set({ token: generateLinkToken() })
    .where(eq(intakeFormTable.projectId, projectId));
  return getFormSettings(projectId);
}

type PublicField = {
  id: string;
  name: string;
  type: "text" | "number" | "date" | "dropdown" | "boolean";
  options: string[] | null;
  required: boolean;
};

const FIELD_TYPES = ["text", "number", "date", "dropdown", "boolean"] as const;

function optionList(options: unknown): string[] | null {
  let list: unknown = options;
  if (typeof options === "string") {
    try {
      list = JSON.parse(options);
    } catch {
      return null;
    }
  }
  return Array.isArray(list)
    ? list.filter((value): value is string => typeof value === "string")
    : null;
}

/**
 * A live form by its token: enabled, public sharing on, project open with
 * Intake on. Anything else reads as the same 404.
 */
export async function resolvePublicForm(token: string) {
  if (!isLinkTokenFormat(token)) {
    throw new HTTPException(404, { message: FORM_NOT_FOUND });
  }
  const instance = await publicBoardInstanceState();
  if (!instance.publicBoards) {
    throw new HTTPException(404, { message: FORM_NOT_FOUND });
  }
  const [row] = await db
    .select({
      form: intakeFormTable,
      intakeEnabled: projectTable.intakeEnabled,
      archivedAt: projectTable.archivedAt,
      deletedAt: projectTable.deletedAt,
    })
    .from(intakeFormTable)
    .innerJoin(projectTable, eq(projectTable.id, intakeFormTable.projectId))
    .where(eq(intakeFormTable.token, token))
    .limit(1);
  if (
    !row?.form.enabled ||
    !row.intakeEnabled ||
    row.archivedAt ||
    row.deletedAt
  ) {
    throw new HTTPException(404, { message: FORM_NOT_FOUND });
  }

  const ids = row.form.customFieldIds ?? [];
  const definitions =
    ids.length === 0
      ? []
      : await db
          .select({
            id: customFieldDefinitionTable.id,
            name: customFieldDefinitionTable.name,
            type: customFieldDefinitionTable.type,
            options: customFieldDefinitionTable.options,
            required: customFieldDefinitionTable.required,
          })
          .from(customFieldDefinitionTable)
          .where(
            and(
              eq(customFieldDefinitionTable.projectId, row.form.projectId),
              inArray(customFieldDefinitionTable.id, ids),
            ),
          );
  const byId = new Map(definitions.map((field) => [field.id, field]));
  const fields: PublicField[] = ids.flatMap((id) => {
    const field = byId.get(id);
    if (!field) return [];
    const type = (FIELD_TYPES as readonly string[]).includes(field.type)
      ? (field.type as PublicField["type"])
      : "text";
    return [
      {
        id: field.id,
        name: field.name,
        type,
        options: type === "dropdown" ? optionList(field.options) : null,
        required: field.required,
      },
    ];
  });
  return { form: row.form, fields };
}

export type ResolvedForm = Awaited<ReturnType<typeof resolvePublicForm>>;

export function toPublicForm({ form, fields }: ResolvedForm) {
  return {
    title: form.title,
    intro: form.intro,
    fields: {
      description: form.descriptionField,
      email: form.emailField,
      name: form.nameField,
    },
    customFields: fields,
    confirmationMessage: form.confirmationMessage,
  };
}

export type PublicSubmission = {
  title: string;
  description?: string;
  email?: string;
  name?: string;
  customFields?: Record<string, string>;
  website?: string;
  elapsedMs?: number;
};

/** Honeypot filled or sent faster than a person types: drop it quietly. */
export function looksAutomated(input: PublicSubmission): boolean {
  if (input.website && input.website.trim() !== "") return true;
  return typeof input.elapsedMs === "number" && input.elapsedMs < MIN_FILL_MS;
}

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

function requireMode(mode: string, value: string, message: string) {
  if (mode === "required" && value === "") {
    throw new HTTPException(400, { message });
  }
}

/** The validated values of the form's custom fields. */
export function formCustomFieldValues(
  fields: ResolvedForm["fields"],
  given: Record<string, string> | undefined,
) {
  const values: { fieldId: string; value: string }[] = [];
  for (const field of fields) {
    const value = (given?.[field.id] ?? "").trim();
    if (value === "") {
      if (field.required) {
        throw new HTTPException(400, { message: `${field.name} is required` });
      }
      continue;
    }
    if (field.type === "text") {
      if (value.length > MAX_CUSTOM_TEXT) {
        throw new HTTPException(400, {
          message: `${field.name} can be at most 1,000 characters`,
        });
      }
    } else {
      const error = validateCustomFieldValue(
        value,
        field.type,
        field.name,
        field.options ?? undefined,
      );
      if (error) throw new HTTPException(400, { message: error });
    }
    values.push({ fieldId: field.id, value });
  }
  return values;
}

/** Files a form submission into intake; returns the confirmation. */
export async function submitPublicForm(
  resolved: ResolvedForm,
  input: PublicSubmission,
) {
  const { form, fields } = resolved;
  const confirmation = { confirmationMessage: form.confirmationMessage };
  if (looksAutomated(input)) return confirmation;

  const title = sanitizeRequestTitle(input.title);
  const description =
    form.descriptionField === "off"
      ? ""
      : sanitizeRequestDescription(input.description);
  requireMode(form.descriptionField, description, "Add a description");

  const email =
    form.emailField === "off" ? "" : (input.email ?? "").trim().toLowerCase();
  requireMode(form.emailField, email, "Add your email address");
  if (email && (!EMAIL.test(email) || email.length > 320)) {
    throw new HTTPException(400, { message: "Enter a valid email address" });
  }
  const name =
    form.nameField === "off"
      ? ""
      : (input.name ?? "").replace(/\s+/g, " ").trim();
  requireMode(form.nameField, name, "Add your name");
  if (name.length > MAX_NAME) {
    throw new HTTPException(400, {
      message: "Names can be at most 200 characters",
    });
  }

  await submitIntakeItem({
    projectId: form.projectId,
    submittedBy: null,
    title,
    description,
    priority: "no-priority",
    source: "form",
    submitter:
      email || name ? { email: email || null, name: name || null } : undefined,
    customFieldValues: formCustomFieldValues(fields, input.customFields),
  });
  return confirmation;
}
