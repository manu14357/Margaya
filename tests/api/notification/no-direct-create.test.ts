import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Task notification paths must go through notifyTaskEvent (the recipients
// helper). Only the notification module itself and the set-based reminder
// scheduler may create single notifications directly.
const sourceRoot = resolve(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("notification paths", () => {
  it("never call createNotification outside the allowed places", () => {
    const offenders = sourceFiles(sourceRoot)
      .map((path) => relative(sourceRoot, path).replaceAll("\\", "/"))
      .filter(
        (path) =>
          !path.startsWith("notification/") &&
          path !== "scheduler/due-date-reminders.ts",
      )
      .filter((path) =>
        readFileSync(join(sourceRoot, path), "utf8").includes(
          "createNotification(",
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("route comments, descriptions and mentions through notifyTaskEvent", () => {
    for (const path of [
      "activity/controllers/create-comment.ts",
      "mention/sync.ts",
      "notification/subscribers.ts",
    ]) {
      expect(readFileSync(join(sourceRoot, path), "utf8")).toContain(
        "notifyTaskEvent(",
      );
    }
  });
});
