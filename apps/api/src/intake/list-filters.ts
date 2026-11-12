import { HTTPException } from "hono/http-exception";
import { TASK_SHORT_ID_PATTERN } from "../search/task-short-id";
import { VALID_PRIORITIES } from "../task/validate-task-fields";
import {
  defaultTabStatuses,
  INTAKE_SOURCES,
  type IntakeSource,
  type IntakeStatus,
  type IntakeTab,
  tabStatuses,
} from "./status";

// Pure parsing of the list route's query (B7 §3.4). The SQL lives in
// queries.ts.

/** Splits a comma list, trimming and dropping empty and repeated values. */
export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}

/** The statuses to list: a subset of the tab's, or the tab's default. */
export function resolveStatusFilter(
  tab: IntakeTab,
  value: string | undefined,
): IntakeStatus[] {
  const requested = splitList(value);
  if (requested.length === 0) return [...defaultTabStatuses(tab)];
  const allowed = tabStatuses(tab) as readonly string[];
  for (const status of requested) {
    if (!allowed.includes(status)) {
      throw new HTTPException(400, {
        message: `Status ${status} doesn't belong to the ${tab} tab`,
      });
    }
  }
  return requested as IntakeStatus[];
}

export function resolvePriorityFilter(value: string | undefined): string[] {
  const requested = splitList(value);
  for (const priority of requested) {
    if (!(VALID_PRIORITIES as readonly string[]).includes(priority)) {
      throw new HTTPException(400, {
        message: `Invalid priority "${priority}". Valid values: ${VALID_PRIORITIES.join(", ")}`,
      });
    }
  }
  return requested;
}

export function resolveSourceFilter(value: string | undefined): IntakeSource[] {
  const requested = splitList(value);
  for (const source of requested) {
    if (!(INTAKE_SOURCES as readonly string[]).includes(source)) {
      throw new HTTPException(400, {
        message: `Invalid source "${source}". Valid values: ${INTAKE_SOURCES.join(", ")}`,
      });
    }
  }
  return requested as IntakeSource[];
}

export type IntakeSearch =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | { kind: "key"; text: string; slug: string; number: number }
  | { kind: "number"; text: string; number: number };

const MAX_TASK_NUMBER = 2_147_483_647;

function validNumber(value: string): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= MAX_TASK_NUMBER
    ? number
    : null;
}

/**
 * Classifies the search box: a task key (`WEB-12`, any case) or a bare
 * number also match by number; every search matches title text.
 */
export function classifySearch(value: string | undefined): IntakeSearch {
  const text = value?.trim() ?? "";
  if (!text) return { kind: "none" };

  if (/^\d+$/.test(text)) {
    const number = validNumber(text);
    if (number !== null) return { kind: "number", text, number };
  }

  const key = TASK_SHORT_ID_PATTERN.exec(text);
  if (key?.[1] && key[2]) {
    const number = validNumber(key[2]);
    if (number !== null) {
      return { kind: "key", text, slug: key[1], number };
    }
  }

  return { kind: "text", text };
}

export type SubmitterFilter =
  | { kind: "any" }
  | { kind: "user"; userId: string };

/**
 * Who the list is limited to. Callers who can only see their own requests
 * are always limited to themselves; naming someone else then matches
 * nothing (an empty list, not an error).
 */
export function resolveSubmitterFilter(
  value: string | undefined,
  callerId: string,
  ownOnly: boolean,
): SubmitterFilter | { kind: "nobody" } {
  const trimmed = value?.trim() ?? "";
  const requested = trimmed === "me" ? callerId : trimmed;
  if (ownOnly) {
    if (requested && requested !== callerId) return { kind: "nobody" };
    return { kind: "user", userId: callerId };
  }
  return requested ? { kind: "user", userId: requested } : { kind: "any" };
}
