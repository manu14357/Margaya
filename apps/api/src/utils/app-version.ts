import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cachedVersion: string | null = null;

// The nearest package.json above this module that carries a version: the
// workspace root in development and in the bundled image alike.
export function appVersion(): string {
  if (cachedVersion) return cachedVersion;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const file = join(dir, "package.json");
    if (existsSync(file)) {
      try {
        const version = JSON.parse(readFileSync(file, "utf8")).version;
        if (typeof version === "string") {
          cachedVersion = version;
          return version;
        }
      } catch {}
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cachedVersion = "unknown";
  return cachedVersion;
}
