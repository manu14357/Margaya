// Scoring for the agent eval harness (agent-eval.ts). An agent run is judged
// by what it did to the database, not by its transcript: the state after the
// run is diffed against the state before, and the diff must match the
// scenario's expectations exactly. A change nobody expected (collateral
// damage) fails the run as surely as a missing one. Pure: no database.

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;
/** table -> stable row key -> the row's compared fields. */
export type Snapshot = Record<string, Record<string, Row>>;

export type DiffEntry =
  | { table: string; key: string; kind: "added"; after: Row }
  | { table: string; key: string; kind: "removed"; before: Row }
  | {
      table: string;
      key: string;
      kind: "changed";
      before: Row;
      after: Row;
      fields: string[];
    };

/** Every row added, removed or changed between two snapshots, in a stable order. */
export function diffSnapshots(before: Snapshot, after: Snapshot): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const tables = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort();
  for (const table of tables) {
    const was = before[table] ?? {};
    const now = after[table] ?? {};
    const keys = [
      ...new Set([...Object.keys(was), ...Object.keys(now)]),
    ].sort();
    for (const key of keys) {
      const a = was[key];
      const b = now[key];
      if (!a && b) entries.push({ table, key, kind: "added", after: b });
      else if (a && !b)
        entries.push({ table, key, kind: "removed", before: a });
      else if (a && b) {
        const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])]
          .filter((field) => (a[field] ?? null) !== (b[field] ?? null))
          .sort();
        if (fields.length) {
          entries.push({
            table,
            key,
            kind: "changed",
            before: a,
            after: b,
            fields,
          });
        }
      }
    }
  }
  return entries;
}

/**
 * One expected row change. `where` must hold on the row (its new values;
 * the old ones for a removal). For a change, `fields` lists exactly the
 * fields that must differ, and `before` (optional) what they held.
 */
export type Expectation = {
  table: string;
  kind: DiffEntry["kind"];
  key?: string;
  where?: Row;
  fields?: string[];
  before?: Row;
};

function holds(row: Row, wanted: Row | undefined): boolean {
  if (!wanted) return true;
  return Object.entries(wanted).every(
    ([field, value]) => (row[field] ?? null) === value,
  );
}

function matches(entry: DiffEntry, expected: Expectation): boolean {
  if (entry.table !== expected.table || entry.kind !== expected.kind) {
    return false;
  }
  if (expected.key !== undefined && entry.key !== expected.key) return false;
  switch (entry.kind) {
    case "added":
      return holds(entry.after, expected.where);
    case "removed":
      return holds(entry.before, expected.where);
    case "changed":
      return (
        holds(entry.after, expected.where) &&
        holds(entry.before, expected.before) &&
        (expected.fields === undefined ||
          (expected.fields.length === entry.fields.length &&
            [...expected.fields].sort().every((f, i) => f === entry.fields[i])))
      );
  }
}

export type Score = {
  pass: boolean;
  /** Expected changes that did not happen. */
  missing: Expectation[];
  /** Changes nothing asked for. */
  unexpected: DiffEntry[];
};

/** Whether the diff is exactly what was expected: nothing missing, nothing extra. */
export function scoreDiff(actual: DiffEntry[], expected: Expectation[]): Score {
  const unmatched = [...actual];
  const missing: Expectation[] = [];
  for (const wanted of expected) {
    const index = unmatched.findIndex((entry) => matches(entry, wanted));
    if (index === -1) missing.push(wanted);
    else unmatched.splice(index, 1);
  }
  return {
    pass: missing.length === 0 && unmatched.length === 0,
    missing,
    unexpected: unmatched,
  };
}

export type Reliability = {
  k: number;
  passes: number;
  /** Share of single runs that passed. */
  passAt1: number;
  /** Passed in every one of the k runs (pass^k): what routine automation needs. */
  passHatK: boolean;
};

export function reliability(results: boolean[]): Reliability {
  const passes = results.filter(Boolean).length;
  return {
    k: results.length,
    passes,
    passAt1: results.length ? passes / results.length : 0,
    passHatK: results.length > 0 && passes === results.length,
  };
}
