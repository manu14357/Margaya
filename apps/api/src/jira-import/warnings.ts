const MAX_WARNINGS = 50;

/**
 * Collects import warnings once per message with how many issues hit it, so
 * a file of thousands of issues reports a short list.
 */
export class WarningLog {
  private readonly entries = new Map<
    string,
    { count: number; example?: string }
  >();

  add(message: string, example?: string) {
    const entry = this.entries.get(message);
    if (entry) {
      entry.count += 1;
      return;
    }
    if (this.entries.size >= MAX_WARNINGS) return;
    this.entries.set(message, { count: 1, example });
  }

  list(): Array<{ message: string; count: number }> {
    return [...this.entries.entries()].map(([message, entry]) => ({
      message: entry.example ? `${message} (e.g. ${entry.example})` : message,
      count: entry.count,
    }));
  }
}
