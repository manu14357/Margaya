import type { ColumnGroup } from "../column/groups";
import {
  ARCHIVED_STATUS,
  entryColumn,
  PLANNED_STATUS,
  type TaskGroup,
} from "../task/scope";

// Pure decisions of "make a copy": which options apply, where the copy
// lands, which custom field values it gets, and the description rewrite.

export const COPY_OPTION_KEYS = [
  "description",
  "assignees",
  "labels",
  "dates",
  "customFields",
  "parent",
  "planning",
  "links",
  "attachments",
] as const;

export type CopyOption = (typeof COPY_OPTION_KEYS)[number];

/** What a copy brings along when the request names no options. */
export const DEFAULT_COPY_OPTIONS: readonly CopyOption[] = [
  "description",
  "assignees",
  "labels",
  "dates",
  "customFields",
  "parent",
  "planning",
];

/** Options that only make sense inside the source's own project. */
const SAME_PROJECT_ONLY = new Set<CopyOption>([
  "customFields",
  "parent",
  "planning",
]);

export type SourceData = Record<CopyOption, boolean>;

/**
 * Splits the requested options: those with source data that the target
 * allows are applied; those with data the target can't take (parent, custom
 * field values and planning across projects) are reported as skipped.
 * Options without source data are neither.
 */
export function planCopyOptions({
  requested,
  sameProject,
  sourceHas,
}: {
  requested: readonly CopyOption[];
  sameProject: boolean;
  sourceHas: SourceData;
}): { apply: Set<CopyOption>; skipped: CopyOption[] } {
  const apply = new Set<CopyOption>();
  const skipped: CopyOption[] = [];
  for (const option of new Set(requested)) {
    if (!sourceHas[option]) continue;
    if (!sameProject && SAME_PROJECT_ONLY.has(option)) {
      skipped.push(option);
    } else {
      apply.add(option);
    }
  }
  return { apply, skipped };
}

export type CopyColumn = {
  id: string;
  slug: string;
  position: number;
  group: ColumnGroup;
};

export type CopyStatus = {
  status: string;
  columnId: string | null;
  group: TaskGroup;
};

/**
 * Where the copy lands among the target's (non-triage) columns: a planned
 * source stays planned; otherwise the column with the source's slug, else
 * the entry column (a legacy archived status also goes there). Null when the
 * target has no open column to fall back on.
 */
export function resolveCopyStatus(
  sourceStatus: string,
  targetColumns: readonly CopyColumn[],
): CopyStatus | null {
  if (sourceStatus === PLANNED_STATUS) {
    return { status: PLANNED_STATUS, columnId: null, group: "backlog" };
  }
  const columns = targetColumns.filter((column) => column.group !== "triage");
  const sameSlug =
    sourceStatus === ARCHIVED_STATUS
      ? undefined
      : columns.find((column) => column.slug === sourceStatus);
  const column = sameSlug ?? entryColumn(columns);
  if (!column) return null;
  return { status: column.slug, columnId: column.id, group: column.group };
}

export type CopyFieldDefinition = {
  id: string;
  name: string;
  required: boolean;
  defaultValue: string | null;
};

function isFilled(value: string | null | undefined): value is string {
  return value != null && value.trim() !== "";
}

/**
 * The custom field values of the copy. All source values come along when
 * `copyAll`; required fields always keep theirs, so the copy satisfies the
 * project's rules. A required field without a value falls back to its
 * default, as on create; without one, the copy is refused.
 */
export function planCustomFieldValues({
  targetFields,
  sourceValues,
  copyAll,
}: {
  targetFields: readonly CopyFieldDefinition[];
  sourceValues: ReadonlyMap<string, string | null>;
  copyAll: boolean;
}):
  | { ok: true; values: { fieldId: string; value: string }[] }
  | { ok: false; missingField: string } {
  const values: { fieldId: string; value: string }[] = [];
  for (const field of targetFields) {
    const value = sourceValues.get(field.id);
    if (isFilled(value) && (copyAll || field.required)) {
      values.push({ fieldId: field.id, value });
    } else if (field.required) {
      if (!isFilled(field.defaultValue)) {
        return { ok: false, missingField: field.name };
      }
      values.push({ fieldId: field.id, value: field.defaultValue });
    }
  }
  return { ok: true, values };
}

const ASSET_URL_PATTERN = /\/api\/asset\/([a-z0-9]+)/gi;

/**
 * Points the copied description at the duplicated files: every
 * `/api/asset/{old}` with a mapped id becomes `/api/asset/{new}`. Hosts and
 * other asset URLs are left untouched.
 */
export function rewriteAssetUrls(
  description: string,
  newIds: ReadonlyMap<string, string>,
): string {
  if (newIds.size === 0) return description;
  return description.replace(ASSET_URL_PATTERN, (match, id: string) => {
    const next = newIds.get(id);
    return next ? `/api/asset/${next}` : match;
  });
}
