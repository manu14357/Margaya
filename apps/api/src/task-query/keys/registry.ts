import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { QueryContext } from "../context";
import type { FilterCondition } from "../schema";

// One descriptor per filter key. The compiler owns the operators and the
// set semantics (`in`, `notIn`, `none`, `me`); a descriptor only says how to
// test one task against a value set. Later slices register their own keys
// from their own files, for example B10:
//
//   registerFilterKey({
//     key: "subscriber",
//     kind: "set",
//     tokens: ["me"],
//     personal: true,
//     matchAny: (userIds) => sql`exists (... subscriber in ${userIds})`,
//     isEmpty: () => sql`not exists (...)`,
//   });
//
// SQL is correlated to the outer, unaliased `task` row, with `column` LEFT
// JOINed through taskColumnJoin (the same contract as task/scope.ts).

export type SetFilterKey = {
  key: string;
  kind: "set";
  /**
   * Tokens understood besides ids. `none` is always accepted; `me` is
   * replaced with the caller's user id before `matchAny` runs.
   */
  tokens?: readonly string[];
  /** A closed list of values (plus tokens and `none`); others give 400. */
  values?: readonly string[];
  /** The condition must name a custom field in `fieldId`. */
  needsFieldId?: boolean;
  /** Refused in a public context (a public board has no caller). */
  personal?: boolean;
  /**
   * True when the task's value set shares a value with `values`. Never
   * NULL. `values` is non-empty, deduplicated, without `none`.
   */
  matchAny(
    values: readonly string[],
    context: QueryContext,
    condition: FilterCondition,
  ): SQL;
  /** True when the task has no value (or its feature is off). Never NULL. */
  isEmpty(context: QueryContext, condition: FilterCondition): SQL;
};

export type DateFilterKey = {
  key: string;
  kind: "date";
  /** A task timestamp column; days are compared in the requester's zone. */
  column: AnyPgColumn;
  nullable: boolean;
  personal?: boolean;
};

export type FilterKeyDescriptor = SetFilterKey | DateFilterKey;

/** Keys that later slices own; unsupported until they register them. */
export const RESERVED_FILTER_KEYS = ["subscriber", "mention"] as const;

export class FilterKeyRegistry {
  private readonly descriptors = new Map<string, FilterKeyDescriptor>();

  register(descriptor: FilterKeyDescriptor): void {
    if (this.descriptors.has(descriptor.key)) {
      throw new Error(`Filter key "${descriptor.key}" is already registered`);
    }
    this.descriptors.set(descriptor.key, descriptor);
  }

  get(key: string): FilterKeyDescriptor | null {
    return this.descriptors.get(key) ?? null;
  }

  has(key: string): boolean {
    return this.descriptors.has(key);
  }

  keys(): string[] {
    return [...this.descriptors.keys()];
  }
}

/** The engine's registry; built-in keys register themselves in ./index.ts. */
export const filterKeyRegistry = new FilterKeyRegistry();

/** Adds a filter key to the engine (one line per key for later slices). */
export function registerFilterKey(descriptor: FilterKeyDescriptor): void {
  filterKeyRegistry.register(descriptor);
}

export function isFilterKeyRegistered(key: string): boolean {
  return filterKeyRegistry.has(key);
}
