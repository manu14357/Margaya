// A pretty-printed JSON document written task by task. The concatenated
// parts are byte-for-byte what JSON.stringify(document, null, 2) produces
// (plus a final newline), without holding every task object at once.

const TASK_INDENT = "    ";

export class JsonTaskDocument {
  private count = 0;

  /** `meta` holds every top-level key; the list (`tasks`) is appended last. */
  constructor(
    private readonly meta: Record<string, unknown>,
    private readonly listKey = "tasks",
  ) {}

  /** Everything up to and including the opening bracket of the list. */
  head(): string {
    const empty = JSON.stringify({ ...this.meta, [this.listKey]: [] }, null, 2);
    return empty.slice(0, empty.length - "]\n}".length);
  }

  task(value: unknown): string {
    const body = JSON.stringify(value, null, 2)
      .split("\n")
      .map((line) => `${TASK_INDENT}${line}`)
      .join("\n");
    const separator = this.count === 0 ? "\n" : ",\n";
    this.count += 1;
    return `${separator}${body}`;
  }

  tail(): string {
    return this.count === 0 ? "]\n}\n" : "\n  ]\n}\n";
  }
}
