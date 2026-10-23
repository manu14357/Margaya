import { execFileSync } from "node:child_process";
import { DOCS_DIR } from "./source";

// "Last updated" dates come from git history, read once per build with a
// single `git log`. Builds without git (a Docker context has no .git) get no
// dates, and the page hides the line rather than inventing one.

let dates: Map<string, string> | null = null;

function readHistory(): Map<string, string> {
  const result = new Map<string, string>();
  try {
    const log = execFileSync(
      "git",
      [
        "log",
        "--relative",
        "--name-only",
        "--no-renames",
        "--format=%x00%cI",
        "--",
        ".",
      ],
      {
        cwd: DOCS_DIR,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    // Newest commits come first, so the first date seen for a file wins.
    for (const commit of log.split("\0")) {
      const [date, ...files] = commit.trim().split("\n");
      if (!date) continue;
      for (const file of files) {
        const name = file.trim();
        if (name && !result.has(name)) result.set(name, date.trim());
      }
    }
  } catch {
    // No git, or not a repository: leave every date unknown.
  }
  return result;
}

/** The ISO date of the last commit that touched a docs page, if known. */
export function getDocLastUpdated(id: string): string | null {
  dates ??= readHistory();
  return dates.get(`${id}.mdx`) ?? dates.get(`${id}.md`) ?? null;
}

const FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** `10 Oct 2026`. */
export function formatDocDate(iso: string): string {
  return FORMAT.format(new Date(iso));
}
